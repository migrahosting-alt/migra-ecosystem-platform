import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';

import {
  signAssertion, sha256Hex, ASSERTION_ENVELOPE_VERSION, MAX_ASSERTION_TTL_MS,
  type AssertionFields,
} from '../engine/internalAuth/assertion.js';
import { ACTION_MODELS_QUALIFY, SERVICE_QUALIFICATION_CLI, loadSigningKeys } from '../engine/internalAuth/config.js';

/**
 * The governed model-qualification tool.
 *
 * WHAT IT IS FOR. There is no deployed operator surface yet, and the alternative
 * — hand-editing a manifest on the host — is the mechanism this whole slice
 * exists to replace. This keeps every property that mattered about that
 * replacement: a human authenticated by MigraAuth, a permission checked against
 * the authority that owns it, a signed request the Brain verifies, and a durable
 * decision naming both identities.
 *
 * WHAT IT IS NOT. It is not "SSH access means approval". Being able to run this
 * proves nothing on its own: without a MigraAuth token belonging to someone
 * holding `platform.models.qualify`, it refuses before it signs anything.
 *
 * THE APPROVER IS NEVER AN ARGUMENT. It comes from `/v1/admin/me`, from the
 * authority that authenticated the token. A `--approver` flag would make the
 * chain of custody a claim by whoever typed the command.
 */

export interface AdminMeResponse {
  user_id?: unknown;
  email?: unknown;
  permissions?: unknown;
  roles?: unknown;
}

export class CliRefusal extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'CliRefusal';
  }
}

/**
 * Establish who is approving, from the authority's own answer.
 *
 * THE EFFECTIVE PERMISSION IS THE TEST, not the role name. Someone may hold a
 * senior-sounding role that does not carry `platform.models.qualify`, and a tool
 * that accepted "owner" as a proxy would approve models on the strength of a
 * label rather than a grant.
 */
export function approverFrom(me: AdminMeResponse): { approverId: string; email: string | null } {
  const permissions = Array.isArray(me?.permissions) ? me.permissions : null;
  if (!permissions) {
    throw new CliRefusal('no_permissions', 'The authority did not return an effective permission set.');
  }
  if (!permissions.includes(ACTION_MODELS_QUALIFY)) {
    throw new CliRefusal(
      'not_permitted',
      `This account does not hold ${ACTION_MODELS_QUALIFY}. Roles alone are not sufficient.`,
    );
  }
  const userId = me?.user_id;
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new CliRefusal('no_identity', 'The authority did not return a canonical user id to attribute this to.');
  }
  return { approverId: `user:${userId}`, email: typeof me.email === 'string' ? me.email : null };
}

export interface EvidenceView {
  id: string;
  modelId: string;
  capability: string;
  modelVersion?: string | undefined;
  modelDigest?: string | undefined;
  passed: boolean;
  license?: string | undefined;
  suite?: string | undefined;
}

/**
 * Guard against approving something other than what was shown.
 *
 * The Brain re-validates independently, but that closes a different gap: this
 * one is between what the HUMAN read on screen and what the tool then signed. A
 * record that changed in between — a re-run overwriting a digest, a different
 * evidence id resolving — must abort rather than silently approve bytes nobody
 * looked at.
 */
export function evidenceUnchanged(shown: EvidenceView, refetched: EvidenceView | null): boolean {
  if (!refetched) return false;
  return (
    shown.id === refetched.id &&
    shown.modelId === refetched.modelId &&
    shown.capability === refetched.capability &&
    (shown.modelVersion ?? null) === (refetched.modelVersion ?? null) &&
    (shown.modelDigest ?? null) === (refetched.modelDigest ?? null) &&
    shown.passed === refetched.passed
  );
}

export interface MutationRequest {
  path: string;
  body: Record<string, unknown>;
}

/**
 * The ONLY payloads this tool can produce.
 *
 * Fixed schemas, built from named arguments. No free-form JSON reaches a
 * governed route through here, so an operator cannot hand-craft a body that
 * routes around validation — which is the point of a tool rather than a curl
 * command with a signature helper.
 */
export function approveRequest(input: {
  modelId: string; capability: string; evidenceRunId: string; note?: string | undefined;
}): MutationRequest {
  return {
    path: '/api/ai/model-qualification/approve',
    body: {
      modelId: input.modelId,
      capability: input.capability,
      evidenceRunId: input.evidenceRunId,
      ...(input.note ? { note: input.note } : {}),
    },
  };
}

/**
 * Record a measurement that happened.
 *
 * `results` is deliberately opaque — a battery measures what a battery measures,
 * and pinning its shape here would mean editing this tool to add a test case.
 * Everything the GOVERNANCE relies on is fixed and named: which model, which
 * exact bytes, which suite, and whether it passed. `passed` is a boolean the
 * caller must state, never inferred from the blob.
 */
export function evidenceRequest(input: {
  modelId: string; capability: string; suite: string; passed: boolean;
  modelVersion?: string | undefined; modelDigest?: string | undefined;
  provider?: string | undefined; license?: string | undefined;
  licenseSource?: string | undefined; results: unknown; environment?: unknown;
}): MutationRequest {
  return {
    path: '/api/ai/model-qualification/evidence',
    body: {
      modelId: input.modelId,
      capability: input.capability,
      suite: input.suite,
      passed: input.passed,
      provider: input.provider ?? 'local',
      ...(input.modelVersion ? { modelVersion: input.modelVersion } : {}),
      ...(input.modelDigest ? { modelDigest: input.modelDigest } : {}),
      ...(input.license ? { license: input.license } : {}),
      ...(input.licenseSource ? { licenseSource: input.licenseSource } : {}),
      results: input.results,
      ...(input.environment === undefined ? {} : { environment: input.environment }),
    },
  };
}

/**
 * The measured outcome, stated rather than assumed.
 *
 * NEITHER IS THE DEFAULT. A battery result is the whole point of an evidence
 * record; defaulting a missing flag either way turns forgetting to type it into
 * a claim about what was measured. Both flags together is equally a mistake, and
 * guessing which one was meant is exactly the wrong instinct here.
 */
export function requireExplicitOutcome(passed: boolean, failed: boolean): boolean {
  if (passed === failed) {
    throw new CliRefusal('bad_usage', 'State the outcome explicitly: exactly one of --passed or --failed.');
  }
  return passed;
}

export function revokeRequest(input: {
  modelId: string; capability: string; reason: string;
}): MutationRequest {
  return {
    path: '/api/ai/model-qualification/revoke',
    body: { modelId: input.modelId, capability: input.capability, reason: input.reason },
  };
}

export interface SignedRequest {
  assertionHeader: string;
  rawBody: string;
  requestId: string;
}

/**
 * Sign a mutation.
 *
 * Timestamps and the request id are generated HERE, not accepted from a caller:
 * a replayable nonce or a stretched validity window supplied from outside would
 * undo the guarantees the Brain relies on.
 */
export function signMutation(input: {
  request: MutationRequest;
  approverId: string;
  keyId: string;
  key: string;
  now?: number;
}): SignedRequest {
  const now = input.now ?? Date.now();
  const rawBody = JSON.stringify(input.request.body);
  const requestId = randomUUID();

  const fields: AssertionFields = {
    v: ASSERTION_ENVELOPE_VERSION,
    keyId: input.keyId,
    serviceId: SERVICE_QUALIFICATION_CLI,
    approverId: input.approverId,
    action: ACTION_MODELS_QUALIFY,
    method: 'POST',
    path: input.request.path,
    bodyDigest: sha256Hex(rawBody),
    issuedAt: now,
    // Deliberately below the Brain's ceiling: a privileged assertion in flight
    // is a standing credential, and an operator action is immediate.
    expiresAt: now + Math.min(30_000, MAX_ASSERTION_TTL_MS),
    requestId,
  };

  const assertion = { ...fields, mac: signAssertion(fields, input.key) };
  return {
    assertionHeader: Buffer.from(JSON.stringify(assertion), 'utf8').toString('base64'),
    rawBody,
    requestId,
  };
}

/** Everything the human must see before approving. The FULL digest, never a prefix. */
export function confirmationText(input: {
  action: 'approve' | 'revoke';
  evidence: EvidenceView | null;
  modelId: string;
  capability: string;
  approverId: string;
  approverEmail: string | null;
  reason?: string | undefined;
}): string {
  const lines = [
    '',
    '  ── GOVERNED MODEL QUALIFICATION ─────────────────────────────',
    `  decision      ${input.action.toUpperCase()}`,
    `  model         ${input.modelId}`,
    `  capability    ${input.capability}`,
  ];
  if (input.evidence) {
    lines.push(
      `  version       ${input.evidence.modelVersion ?? '(none recorded)'}`,
      /* THE FULL DIGEST. Approving a tag must visibly mean approving these exact
       * bytes, and a truncated hash is a tag with extra steps. */
      `  digest        ${input.evidence.modelDigest ?? '(none recorded)'}`,
      `  evidence run  ${input.evidence.id}`,
      `  suite         ${input.evidence.suite ?? '(unnamed)'}`,
      `  result        ${input.evidence.passed ? 'PASSED' : 'FAILED'}`,
      `  license       ${input.evidence.license ?? '(none recorded)'}`,
    );
  }
  if (input.reason) lines.push(`  reason        ${input.reason}`);
  lines.push(
    `  approver      ${input.approverId}${input.approverEmail ? ` (${input.approverEmail})` : ''}`,
    '  ─────────────────────────────────────────────────────────────',
    '',
  );
  return lines.join('\n');
}

export async function askToConfirm(prompt: string): Promise<boolean> {
  const io = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>((resolve) => io.question(prompt, resolve));
    return answer.trim().toLowerCase() === 'approve';
  } finally {
    io.close();
  }
}

/**
 * Which signing key to use.
 *
 * The HIGHEST version present, so rotation is: add V2, and the tool starts using
 * it without a code change. Absent means refuse — a tool that could not sign must
 * not fall back to sending something unsigned.
 */
export function selectKey(env: NodeJS.ProcessEnv = process.env): { keyId: string; key: string } {
  const keys = loadSigningKeys(env);
  if (keys.size === 0) {
    throw new CliRefusal(
      'no_signing_key',
      'No MIGRAPILOT_QUALIFICATION_SIGNING_KEY_V* is configured. Qualification cannot be signed.',
    );
  }
  const keyId = [...keys.keys()].sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)))[0]!;
  return { keyId, key: keys.get(keyId)! };
}

/** The operator's MigraAuth token. Environment only — argv is world-readable. */
export function readToken(env: NodeJS.ProcessEnv = process.env): string {
  const token = env.MIGRAAUTH_TOKEN?.trim();
  if (!token) {
    throw new CliRefusal(
      'no_token',
      'MIGRAAUTH_TOKEN is not set. Sign in and export the token; it must never be passed as an argument.',
    );
  }
  return token;
}
