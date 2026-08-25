import { createInterface } from 'node:readline';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

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

// ── operator authentication (Authorization Code + PKCE, loopback) ──────────

/**
 * PKCE, because this client has no secret and must not have one.
 *
 * A CLI cannot keep a client secret: it ships to an operator's machine, so the
 * "secret" would be readable by anyone who can run the tool. PKCE replaces it
 * with a per-attempt proof — the verifier never leaves this process, and an
 * intercepted authorization code is useless without it.
 */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export interface AuthorizeParams {
  authorizeEndpoint: string;
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
  scopes: readonly string[];
}

export function buildAuthorizeUrl(p: AuthorizeParams): string {
  const url = new URL(p.authorizeEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', p.clientId);
  url.searchParams.set('redirect_uri', p.redirectUri);
  url.searchParams.set('scope', p.scopes.join(' '));
  url.searchParams.set('state', p.state);
  url.searchParams.set('code_challenge', p.challenge);
  // S256 only. `plain` puts the verifier itself in the authorization request,
  // which is the whole thing PKCE exists to avoid sending.
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/**
 * Read the authorization code out of the loopback callback.
 *
 * THE STATE CHECK IS NOT OPTIONAL. Without it, anything that can reach this
 * loopback port during the window can hand the CLI a code from a different
 * authorization — a code the operator never approved, for an account they do
 * not control. Compared before the code is even looked at.
 */
export function parseCallback(rawUrl: string, expectedState: string): { code: string } {
  const url = new URL(rawUrl, 'http://127.0.0.1');
  const error = url.searchParams.get('error');
  if (error) {
    throw new CliRefusal('authorization_denied', `MigraAuth refused the authorization: ${error}`);
  }
  const state = url.searchParams.get('state');
  if (!state || state !== expectedState) {
    throw new CliRefusal('state_mismatch', 'The callback did not carry the state this attempt issued.');
  }
  const code = url.searchParams.get('code');
  if (!code) {
    throw new CliRefusal('no_code', 'The callback carried no authorization code.');
  }
  return { code };
}

export function tokenRequestBody(input: {
  code: string; verifier: string; clientId: string; redirectUri: string;
}): string {
  return new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    code_verifier: input.verifier,
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
  }).toString();
}

// ── the guided run ─────────────────────────────────────────────────────────

export interface PlannedRecord {
  file: string;
  capability: string;
  suite: string;
  passed: boolean;
  /** Only one record in the plan may be approved, and only if it passed. */
  approve: boolean;
  /** The identity the evidence itself names. Never a flag, never the registry. */
  modelId: string;
  modelVersion: string;
  modelDigest: string;
}

/** `sha256:` followed by exactly 64 hex characters. Anything else is not a digest. */
export const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

/**
 * The identity an evidence record must state about itself.
 *
 * AN EVIDENCE RUN THAT DOES NOT NAME ITS BYTES IS A MEASUREMENT OF NOTHING IN
 * PARTICULAR. The first version of these payloads carried only results and left
 * identity to `--model` and `--digest` on the command line, which meant the
 * recorded run and the approved bytes were two separate claims that could
 * disagree — and the guided flow, which has no flags, had nothing to read at all.
 *
 * Read from the record, so the thing that was measured and the thing that gets
 * approved cannot come apart.
 */
export function evidenceIdentity(file: string, evidence: Record<string, unknown>): {
  modelId: string; modelVersion: string; modelDigest: string;
} {
  const str = (key: string): string => {
    const value = evidence[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new CliRefusal('evidence_incomplete', `${file} does not state ${key}.`);
    }
    return value.trim();
  };
  const modelDigest = str('model_digest');
  if (!DIGEST_PATTERN.test(modelDigest)) {
    // A malformed digest is refused rather than normalised: guessing what
    // someone meant by a truncated hash is how a tag gets approved as bytes.
    throw new CliRefusal('malformed_digest', `${file} states a digest that is not sha256:<64 hex>: ${modelDigest}`);
  }
  return { modelId: str('model_id'), modelVersion: str('model_version'), modelDigest };
}

/**
 * What a guided run will write, decided from the evidence files themselves.
 *
 * THE VERDICT COMES FROM THE EVIDENCE, NOT FROM A FLAG. `--passed` on the
 * command line would let an operator record a pass for a run that failed, which
 * is the one thing this whole path exists to make impossible. Each file states
 * its own verdict and the plan follows it.
 */
export function plannedRecords(
  files: readonly { file: string; evidence: Record<string, unknown> }[],
): PlannedRecord[] {
  return files.map(({ file, evidence }) => {
    const verdict = String(evidence.verdict ?? '').toUpperCase();
    if (verdict !== 'PASSED' && verdict !== 'FAILED') {
      throw new CliRefusal('unreadable_verdict', `${file} does not state PASSED or FAILED.`);
    }
    const capability = typeof evidence.capability_under_test === 'string'
      ? evidence.capability_under_test
      : 'vision';
    const suite = typeof evidence.suite === 'string' ? evidence.suite : '';
    if (!suite) throw new CliRefusal('unreadable_suite', `${file} does not name a suite.`);
    const passed = verdict === 'PASSED';
    const identity = evidenceIdentity(file, evidence);
    return {
      file, capability, suite, passed, ...identity,
      // Approval follows a pass, and only for the scoped general capability. A
      // failed run can never carry one — the Brain refuses it anyway, and the
      // plan must not even offer it.
      approve: passed && capability === 'vision.general',
    };
  });
}

/**
 * Every record in a plan must be about the SAME model and the same bytes.
 *
 * Three files describing three different models would each record cleanly and
 * produce an approval whose evidence chain nobody could follow. Checked before
 * anything is shown, so the confirmation screen can state one identity honestly.
 */
export function assertOneSubject(plan: readonly PlannedRecord[]): {
  modelId: string; modelVersion: string; modelDigest: string;
} {
  const first = plan[0];
  if (!first) throw new CliRefusal('no_evidence', 'No evidence files were loaded.');
  for (const record of plan) {
    if (record.modelId !== first.modelId || record.modelDigest !== first.modelDigest
        || record.modelVersion !== first.modelVersion) {
      throw new CliRefusal(
        'mixed_subjects',
        `${record.file} is about ${record.modelId}@${record.modelDigest.slice(0, 19)}…, ` +
        `but ${first.file} is about ${first.modelId}@${first.modelDigest.slice(0, 19)}…`,
      );
    }
  }
  return { modelId: first.modelId, modelVersion: first.modelVersion, modelDigest: first.modelDigest };
}

/**
 * The recorded run, checked against the plan that produced it, before signing an
 * approval that points at it.
 *
 * The Brain validates independently. This closes the other gap: between what the
 * operator read and what the recorded row actually says.
 */
export function recordedMatchesPlan(step: PlannedRecord, recorded: EvidenceView | null): boolean {
  if (!recorded) return false;
  return (
    recorded.modelId === step.modelId &&
    recorded.capability === step.capability &&
    (recorded.modelDigest ?? null) === step.modelDigest &&
    (recorded.modelVersion ?? null) === step.modelVersion &&
    recorded.passed === step.passed
  );
}

/** The whole plan on one screen, before anything is signed. */
export function guidedPlanText(input: {
  modelId: string;
  version: string;
  digest: string;
  approverId: string;
  approverEmail: string | null;
  records: readonly PlannedRecord[];
}): string {
  const lines = [
    '',
    '  ── WHAT THIS WILL RECORD ────────────────────────────────────',
    `  model         ${input.modelId}`,
    `  version       ${input.version}`,
    /* THE FULL DIGEST. Approving a tag must visibly mean approving these exact
     * bytes, and a truncated hash is a tag with extra steps. */
    `  digest        ${input.digest}`,
    `  approver      ${input.approverId}${input.approverEmail ? ` (${input.approverEmail})` : ''}`,
    '',
  ];
  for (const r of input.records) {
    lines.push(`  ${r.passed ? 'PASSED' : 'FAILED'}  ${r.capability.padEnd(24)} ${r.suite}`);
  }
  const approvals = input.records.filter((r) => r.approve);
  lines.push(
    '',
    approvals.length === 0
      ? '  No approval will be granted.'
      : `  Then APPROVE: ${approvals.map((r) => r.capability).join(', ')}`,
    '  Everything else stays unqualified and will be refused at the boundary.',
    '  ─────────────────────────────────────────────────────────────',
    '',
  );
  return lines.join('\n');
}
