/**
 * MigraAI Engine — startup gating and restart recovery for governed coding.
 *
 * Governed coding is the only Brain capability that WRITES to a user's repository,
 * so it is off unless someone deliberately turned it on and said exactly where it
 * may operate. There is no implicit current-directory permission and no wildcard
 * root: a capability that can edit files must not become available by accident,
 * and "wherever the server happens to be running" is an accident.
 *
 * Invalid configuration does not degrade into a narrower permission — it prevents
 * registration outright and says why. A half-configured write capability is worse
 * than a disabled one, because it looks available.
 *
 * © MigraTeck LLC.
 */

import { realpathSync, statSync } from 'node:fs';
import { delimiter, isAbsolute } from 'node:path';
import type { AgentRunJournal } from '../agentRunJournal.js';
import { readDomainPayload } from '../agentRunJournal.js';
import { markInterruptedChildren } from './codingChildren.js';
import type { DeclaredValidation } from './validationRun.js';
import { classifyInterruptedExecution, recoverPendingScope, type SpanReader } from './codingRecovery.js';
import {
  CODING_DOMAIN_KIND,
  CODING_PAYLOAD_SCHEMA_VERSION,
  parseCodingPayload,
  type CodingRunPayloadV1,
} from './codingRunPayload.js';

// ── Configuration ────────────────────────────────────────────────────────────

export interface CodingConfig {
  enabled: boolean;
  allowedRoots: string[];
  /** Why the capability is unavailable. Empty when it is available. */
  diagnostics: string[];
}

/**
 * Read and VALIDATE the coding configuration.
 *
 * Each root must be absolute, canonical and existent. A configured root that does
 * not resolve is a diagnostic, never a silently dropped entry — an operator who
 * configured three roots and got two would have no way to notice.
 */
export function readCodingConfig(env: NodeJS.ProcessEnv = process.env): CodingConfig {
  const diagnostics: string[] = [];
  const enabled = env.MIGRAPILOT_CODING_ENABLED === '1';
  if (!enabled) {
    return { enabled: false, allowedRoots: [], diagnostics: ['MIGRAPILOT_CODING_ENABLED is not 1; governed coding is disabled by default.'] };
  }

  const raw = (env.MIGRAPILOT_CODING_WORKSPACE_ROOTS ?? '').split(delimiter).map((entry) => entry.trim()).filter(Boolean);
  if (!raw.length) {
    diagnostics.push('MIGRAPILOT_CODING_WORKSPACE_ROOTS is empty; refusing to enable a write capability with no boundary.');
    return { enabled: false, allowedRoots: [], diagnostics };
  }

  const allowedRoots: string[] = [];
  for (const entry of raw) {
    // A filesystem root would make the boundary meaningless.
    if (entry === '/' || entry === '*' || /^[A-Za-z]:[/\\]?$/.test(entry)) {
      diagnostics.push(`Refusing wildcard or filesystem-root workspace root: ${entry}`);
      continue;
    }
    if (!isAbsolute(entry)) {
      diagnostics.push(`Workspace root must be absolute: ${entry}`);
      continue;
    }
    try {
      const canonical = realpathSync(entry);
      if (!statSync(canonical).isDirectory()) {
        diagnostics.push(`Workspace root is not a directory: ${entry}`);
        continue;
      }
      allowedRoots.push(canonical);
    } catch {
      diagnostics.push(`Workspace root does not exist or is unreadable: ${entry}`);
    }
  }

  // Any invalid entry disables the capability. Operating on the subset that
  // happened to resolve would silently change what was authorised.
  if (diagnostics.length) return { enabled: false, allowedRoots: [], diagnostics };
  return { enabled: true, allowedRoots, diagnostics: [] };
}

/**
 * The declared validation command.
 *
 * From configuration, NEVER from the model. A model that could author its own
 * test command could, under pressure to finish, author one that passes. The
 * default is a plain `node --test`, and the value is split on whitespace into a
 * real argv rather than handed to a shell.
 */
export function readCodingValidationCommand(env: NodeJS.ProcessEnv = process.env): DeclaredValidation {
  const raw = (env.MIGRAPILOT_CODING_VALIDATION_COMMAND ?? 'node --test').trim();
  const command = raw.split(/\s+/).filter(Boolean);
  return {
    id: 'coding.validation',
    command: command.length ? command : ['node', '--test'],
    ...(env.MIGRAPILOT_CODING_VALIDATION_TIMEOUT_MS ? { timeoutMs: Number(env.MIGRAPILOT_CODING_VALIDATION_TIMEOUT_MS) } : {}),
  };
}

/**
 * A structured-output model call for planning and changeset authoring.
 *
 * `format: 'json'` and a low temperature because both callers PARSE STRICTLY and
 * repair nothing — a plan that has to be guessed at is a plan nobody wrote, and
 * this one carries write authority.
 */
export function codingStructuredModel(providerBaseUrl: string, model: string): (input: unknown) => Promise<unknown> {
  const url = `${providerBaseUrl.replace(/\/+$/, '').replace(/\/v1$/, '')}/api/chat`;
  return async (input: unknown): Promise<unknown> => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',
        options: { temperature: 0.1 },
        messages: [
          { role: 'system', content: 'You are a precise software engineer. Reply with JSON only, matching the requested shape exactly. Never include prose outside the JSON.' },
          { role: 'user', content: JSON.stringify(input) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`model call failed: ${response.status}`);
    const body = (await response.json()) as { message?: { content?: string } };
    const content = body.message?.content ?? '';
    // Parsing happens in the adapters, which reject rather than repair. Returning
    // the raw string here would make every caller re-implement that decision.
    try { return JSON.parse(content) as unknown; } catch { return content; }
  };
}

// ── Capability metadata ──────────────────────────────────────────────────────

export interface GovernedCodingCapability {
  available: boolean;
  approvalMode: 'scope';
  progressMode: 'polling';
  /** A COUNT. Configured paths are never exposed. */
  workspaceRootsConfigured: number;
  unavailableReason?: string;
}

export function codingCapability(input: { config: CodingConfig; durable: boolean; driverReady: boolean }): GovernedCodingCapability {
  const reasons: string[] = [];
  if (!input.config.enabled) reasons.push(input.config.diagnostics[0] ?? 'disabled');
  if (!input.durable) reasons.push('no durable journal');
  if (!input.driverReady) reasons.push('workflow driver unavailable');
  const available = reasons.length === 0;
  return {
    available,
    approvalMode: 'scope',
    progressMode: 'polling',
    workspaceRootsConfigured: input.config.allowedRoots.length,
    ...(available ? {} : { unavailableReason: reasons.join('; ') }),
  };
}

// ── Restart recovery ─────────────────────────────────────────────────────────

export type CodingRecoveryAction =
  | 'planning_interrupted'
  | 'approval_preserved'
  | 'approval_expired'
  | 'approval_invalidated'
  | 'safe_to_resume'
  | 'mutation_reconciliation_required'
  | 'new_validation_required'
  | 'terminal_write_retry'
  | 'payload_unreadable';

export interface CodingRecoveryOutcome {
  runId: string;
  action: CodingRecoveryAction;
  detail: string;
  interruptedChildren: string[];
}

/**
 * Classify every non-terminal coding run at startup.
 *
 * Deliberately CLASSIFIES rather than resumes. Nothing here re-invokes a model or
 * re-applies a changeset: an apply that was live at process death leaves the tree
 * in a state only the diff can describe, and a model call restarted from a partly
 * mutated tree would be reasoning about a repository that never existed as a whole.
 * The outcome tells an operator (and the next request) what is safe.
 */
export async function recoverCodingRuns(input: {
  journal: AgentRunJournal;
  readSpan: (runId: string) => SpanReader;
  now: number;
}): Promise<CodingRecoveryOutcome[]> {
  const outcomes: CodingRecoveryOutcome[] = [];
  const terminal = new Set(['COMPLETED', 'REJECTED', 'EXPIRED', 'STALE', 'FAILED', 'CANCELLED']);

  for (const run of input.journal.loadRuns()) {
    if (run.domainKind !== CODING_DOMAIN_KIND) continue;
    if (terminal.has(run.state)) continue;

    const read = readDomainPayload<unknown>(run, { kind: CODING_DOMAIN_KIND, maxSchemaVersion: CODING_PAYLOAD_SCHEMA_VERSION });
    if (!read.ok) {
      outcomes.push({ runId: run.runId, action: 'payload_unreadable', detail: `durable payload could not be read (${read.code})`, interruptedChildren: [] });
      continue;
    }
    const parsed = parseCodingPayload(read.payload);
    if (!parsed.ok) {
      outcomes.push({ runId: run.runId, action: 'payload_unreadable', detail: `durable payload failed validation (${parsed.fault})`, interruptedChildren: [] });
      continue;
    }
    const payload: CodingRunPayloadV1 = parsed.payload;

    // Children left unresolved are marked interrupted BEFORE classification, so
    // the classifier reads a settled record rather than a racing one.
    const wasActive = input.journal.children(run.runId).filter((c) => !['completed', 'failed', 'cancelled', 'interrupted'].includes(c.state));
    const interrupted = wasActive.length ? markInterruptedChildren(input.journal, run.runId, input.now) : [];
    const interruptedIds = interrupted.map((c) => c.childId);

    if (payload.phase === 'awaiting_scope_approval') {
      const verdict = await recoverPendingScope({ payload, readSpan: input.readSpan(run.runId), now: input.now });
      const action: CodingRecoveryAction =
        verdict.outcome === 'still_valid' ? 'approval_preserved'
          : verdict.outcome === 'expired' ? 'approval_expired'
            : 'approval_invalidated';
      outcomes.push({ runId: run.runId, action, detail: verdict.detail, interruptedChildren: interruptedIds });
      continue;
    }

    const classified = classifyInterruptedExecution({ children: input.journal.children(run.runId), interrupted });
    if (classified.action === 'requires_mutation_reconciliation') {
      outcomes.push({ runId: run.runId, action: 'mutation_reconciliation_required', detail: classified.detail, interruptedChildren: interruptedIds });
      continue;
    }
    if (classified.action === 'requires_new_validation') {
      outcomes.push({ runId: run.runId, action: 'new_validation_required', detail: classified.detail, interruptedChildren: interruptedIds });
      continue;
    }
    if (payload.phase === 'planning') {
      outcomes.push({ runId: run.runId, action: 'planning_interrupted', detail: 'planning did not reach the approval boundary; a new run is required.', interruptedChildren: interruptedIds });
      continue;
    }
    // Reconciliation completed but the parent never reached terminal: the only
    // outstanding work is the parent's own terminal write.
    const reconciliationDone = input.journal.children(run.runId).some((c) => c.kind === 'reconciliation' && c.state === 'completed');
    outcomes.push({
      runId: run.runId,
      action: reconciliationDone ? 'terminal_write_retry' : 'safe_to_resume',
      detail: reconciliationDone
        ? 'reconciliation completed durably; only the parent terminal revision is outstanding.'
        : 'the approved scope is durable and no mutation child was dispatched.',
      interruptedChildren: interruptedIds,
    });
  }
  return outcomes;
}
