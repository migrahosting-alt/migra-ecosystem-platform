import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import type { AgentModeBootstrapResponse, AgentModeRecipeId } from '@migrapilot/protocol';
import { auditHash, auditStore } from './auditLog.js';

const BOOTSTRAP_TTL_MS = 2 * 60_000;
const ACTIVATION_TTL_MS = 60 * 60_000;
export const AGENT_CAPABILITY_HEADER = 'x-migrapilot-agent-capability';

interface ActivationRecord {
  digest: Buffer;
  activationId: string;
  extensionProcessId: number;
  bootstrapMode: 'inherited' | 'pairing';
  serverInstanceId: string;
  canonicalWorkspace: string;
  workspaceIdentity: string;
  allowedRecipes: AgentModeRecipeId[];
  issuedAt: number;
  expiresAt: number;
}

export interface AgentActivationContext {
  activationId: string;
  extensionProcessId: number;
  serverInstanceId: string;
  canonicalWorkspace: string;
  workspaceIdentity: string;
  allowedRecipes: readonly AgentModeRecipeId[];
}

export class AgentActivationError extends Error {
  constructor(readonly code: 'BOOTSTRAP_UNAVAILABLE' | 'BOOTSTRAP_INVALID' | 'ACTIVATION_INVALID' | 'WORKSPACE_INVALID', message: string) {
    super(message);
    this.name = 'AgentActivationError';
  }
}

/** One process instance owns one one-time bootstrap secret and short-lived
 * activation capabilities. Raw secrets/capabilities are never stored, logged, or
 * persisted: only SHA-256 digests remain after each exchange. */
export class AgentActivationAuthority {
  readonly serverInstanceId = `brain_${randomUUID()}`;
  private bootstrapDigest?: Buffer;
  private readonly bootstrapExpiresAt: number;
  private readonly activations = new Map<string, ActivationRecord>();
  private readonly bootstrapTimer: NodeJS.Timeout;

  constructor(
    bootstrapSecret: string | undefined,
    private readonly now: () => number = () => Date.now(),
    private readonly randomCapability: () => string = () => `agentcap_${randomBytes(32).toString('base64url')}`,
    private readonly inheritedExtensionProcessId: number = process.ppid,
  ) {
    this.bootstrapDigest = bootstrapSecret && bootstrapSecret.length >= 32 ? digest(bootstrapSecret) : undefined;
    this.bootstrapExpiresAt = this.now() + BOOTSTRAP_TTL_MS;
    this.bootstrapTimer = setTimeout(() => { this.bootstrapDigest = undefined; }, BOOTSTRAP_TTL_MS);
    this.bootstrapTimer.unref();
    auditStore.append({ correlationId: this.serverInstanceId, type: 'bootstrap.created', component: 'agent-activation', outcome: this.bootstrapDigest ? 'available' : 'unavailable', fields: { expiresAt: this.bootstrapExpiresAt } });
  }

  static fromEnvironment(env: NodeJS.ProcessEnv = process.env): AgentActivationAuthority {
    const secret = env.MIGRAPILOT_AGENT_BOOTSTRAP_SECRET;
    const extensionProcessId = Number(env.MIGRAPILOT_AGENT_EXTENSION_PID);
    delete env.MIGRAPILOT_AGENT_BOOTSTRAP_SECRET;
    delete env.MIGRAPILOT_AGENT_EXTENSION_PID;
    return new AgentActivationAuthority(secret, undefined, undefined, Number.isSafeInteger(extensionProcessId) && extensionProcessId > 0 ? extensionProcessId : process.ppid);
  }

  async bootstrap(input: { bootstrapSecret: string; activationId: string; extensionProcessId: number; bootstrapMode: 'inherited' | 'pairing'; workspaceRoot: string }): Promise<AgentModeBootstrapResponse> {
    if (!this.bootstrapDigest || this.now() >= this.bootstrapExpiresAt) {
      this.bootstrapDigest = undefined;
      throw new AgentActivationError('BOOTSTRAP_UNAVAILABLE', 'Agent bootstrap is unavailable or expired.');
    }
    const supplied = digest(input.bootstrapSecret);
    if (!safeEqual(supplied, this.bootstrapDigest)) throw new AgentActivationError('BOOTSTRAP_INVALID', 'Agent bootstrap was refused.');
    if (input.bootstrapMode === 'inherited' && input.extensionProcessId !== this.inheritedExtensionProcessId) {
      throw new AgentActivationError('BOOTSTRAP_INVALID', 'Agent bootstrap was refused.');
    }

    // Consume before any subsequent asynchronous operation. A failed workspace
    // validation requires an explicit new pairing/bootstrap rather than replay.
    this.bootstrapDigest = undefined;
    clearTimeout(this.bootstrapTimer);
    const canonicalWorkspace = await realpath(input.workspaceRoot).catch(() => { throw new AgentActivationError('WORKSPACE_INVALID', 'The activation workspace does not exist.'); });
    const workspaceStat = await stat(canonicalWorkspace);
    if (!workspaceStat.isDirectory()) throw new AgentActivationError('WORKSPACE_INVALID', 'The activation workspace is not a directory.');

    const rawCapability = this.randomCapability();
    const issuedAt = this.now();
    const allowedRecipes: AgentModeRecipeId[] = ['git.status', 'git.diff'];
    const record: ActivationRecord = {
      digest: digest(rawCapability),
      activationId: input.activationId,
      extensionProcessId: input.extensionProcessId,
      bootstrapMode: input.bootstrapMode,
      serverInstanceId: this.serverInstanceId,
      canonicalWorkspace,
      workspaceIdentity: directoryIdentity(workspaceStat),
      allowedRecipes,
      issuedAt,
      expiresAt: issuedAt + ACTIVATION_TTL_MS,
    };
    this.activations.set(input.activationId, record);
    auditStore.append({ correlationId: this.serverInstanceId, type: 'bootstrap.consumed', component: 'agent-activation', outcome: 'consumed', fields: { activation: auditHash(input.activationId) } });
    auditStore.append({ correlationId: this.serverInstanceId, type: 'activation.issued', component: 'agent-activation', outcome: 'issued', fields: { activation: auditHash(input.activationId), workspace: auditHash(canonicalWorkspace), expiresAt: record.expiresAt } });
    return { activationCapability: rawCapability, activationId: input.activationId, serverInstanceId: this.serverInstanceId, canonicalWorkspace, allowedRecipes, issuedAt, expiresAt: record.expiresAt };
  }

  async authorize(rawCapability: string | undefined, workspaceRoot: string): Promise<AgentActivationContext> {
    this.cleanup();
    if (!rawCapability) throw new AgentActivationError('ACTIVATION_INVALID', 'Agent activation capability is required.');
    const candidate = digest(rawCapability);
    const record = [...this.activations.values()].find((entry) => safeEqual(candidate, entry.digest));
    if (!record || record.expiresAt <= this.now()) throw new AgentActivationError('ACTIVATION_INVALID', 'Agent activation capability is invalid or expired.');
    const canonical = await realpath(workspaceRoot).catch(() => undefined);
    if (!canonical || canonical !== record.canonicalWorkspace) throw new AgentActivationError('ACTIVATION_INVALID', 'Agent activation is not valid for this workspace.');
    const workspaceStat = await stat(canonical).catch(() => undefined);
    if (!workspaceStat || !workspaceStat.isDirectory() || directoryIdentity(workspaceStat) !== record.workspaceIdentity) {
      throw new AgentActivationError('ACTIVATION_INVALID', 'The activated workspace identity changed.');
    }
    return { activationId: record.activationId, extensionProcessId: record.extensionProcessId, serverInstanceId: record.serverInstanceId, canonicalWorkspace: record.canonicalWorkspace, workspaceIdentity: record.workspaceIdentity, allowedRecipes: record.allowedRecipes };
  }

  shutdown(): void {
    clearTimeout(this.bootstrapTimer);
    this.bootstrapDigest = undefined;
    this.activations.clear();
  }

  private cleanup(): void {
    for (const [id, record] of this.activations) if (record.expiresAt <= this.now()) this.activations.delete(id);
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function safeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function directoryIdentity(value: { dev: number | bigint; ino: number | bigint; birthtimeMs: number; ctimeMs: number }): string {
  return `${value.dev}:${value.ino}:${value.birthtimeMs}:${value.ctimeMs}`;
}
