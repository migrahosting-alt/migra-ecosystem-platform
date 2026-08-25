import { createHmac, timingSafeEqual, createHash } from 'node:crypto';

/**
 * Signed service-to-service assertions for privileged Brain mutations.
 *
 * WHY THIS EXISTS. The Brain has no human authentication and listens on
 * localhost only, so its entire security model is "the consumer is the only
 * caller, and the consumer authenticates". That is fine for product traffic and
 * useless for administrative mutation: an unsigned header saying
 * `approver=bonex` could be invented by any process on the box, and
 * "localhost means authorized" is network-position authority — the same pattern
 * we removed from admin access.
 *
 * So the operator service authenticates the human and enforces the permission;
 * this proves to the Brain that the request genuinely came from that service,
 * unmodified, recently, and only once.
 *
 * IT AUTHENTICATES THE CALLER, IT DOES NOT AUTHORIZE THE HUMAN. The Brain still
 * records BOTH identities, because "the operator service says it checked" must
 * never be the only durable evidence that it did.
 *
 * KEYS ARE VERSIONED FROM DAY ONE. A `keyId` travels in the assertion and the
 * Brain verifies against a small ACTIVE SET, so rotation is: add the new key to
 * both sides, switch the signer, retire the old one — no coordinated instant
 * cutover, no downtime, no window where one service can talk and the other
 * cannot.
 */

export interface AssertionFields {
  keyId: string;
  serviceId: string;
  approverId: string;
  action: string;
  method: string;
  path: string;
  /** sha256 hex of the exact request body. */
  bodyDigest: string;
  issuedAt: number;
  expiresAt: number;
  requestId: string;
}

export interface SignedAssertion extends AssertionFields {
  mac: string;
}

export type AssertionFailure =
  | 'malformed'
  | 'unknown_key'
  | 'unknown_service'
  | 'action_not_granted'
  | 'wrong_action'
  | 'request_mismatch'
  | 'body_mismatch'
  | 'expired'
  | 'not_yet_valid'
  | 'ttl_too_long'
  | 'bad_mac'
  | 'replayed';

export interface VerifyContext {
  /** The action the ROUTE requires — not what the assertion claims. */
  expectedAction: string;
  method: string;
  path: string;
  rawBody: string;
  now?: number;
}

export interface VerifyDeps {
  /** Active signing keys by id. An unknown id is refused, never guessed. */
  keys: ReadonlyMap<string, string>;
  /**
   * Which actions each service may request — a POLICY, not a membership list.
   *
   * Possessing a valid key must not make a caller universally privileged. The
   * key proves WHO is calling; this decides WHAT that caller may ask for, and
   * the two are different questions. A signing key leaked from a service that
   * may only qualify models must not become the power to do everything else the
   * Brain will ever expose.
   */
  servicePolicy: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * Remember a request id until it expires. Returns false if already seen.
   *
   * MUST OUTLIVE A RESTART. Process memory would reopen every nonce the moment
   * the service bounces, which turns replay protection into an uptime-dependent
   * courtesy.
   */
  rememberRequestId(requestId: string, expiresAtMs: number): Promise<boolean>;
}

/** An operator action is deliberate and immediate; a minute is generous. */
export const MAX_ASSERTION_TTL_MS = 60_000;
/** Tolerance for clock drift between two services on the same estate. */
export const CLOCK_SKEW_MS = 5_000;

const FIELD_PATTERN = /^[A-Za-z0-9._:@/-]{1,200}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * The exact bytes that get signed.
 *
 * LENGTH-PREFIXED, NOT DELIMITER-JOINED. Joining with a separator makes
 * `("a","b:c")` and `("a:b","c")` produce identical input, so two different
 * requests could share one MAC. Prefixing each field with its length removes
 * that ambiguity entirely rather than relying on the fields never containing the
 * delimiter.
 */
export function canonicalString(fields: AssertionFields): string {
  const ordered = [
    fields.keyId, fields.serviceId, fields.approverId, fields.action,
    fields.method.toUpperCase(), fields.path, fields.bodyDigest,
    String(fields.issuedAt), String(fields.expiresAt), fields.requestId,
  ];
  return ordered.map((part) => `${Buffer.byteLength(part, 'utf8')}:${part}`).join('|');
}

export function signAssertion(fields: AssertionFields, key: string): string {
  return createHmac('sha256', key).update(canonicalString(fields), 'utf8').digest('hex');
}

function macMatches(expected: string, presented: string): boolean {
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(presented, 'hex');
  // Length must be compared first: timingSafeEqual throws on a length mismatch,
  // and a throw is itself an observable difference.
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type VerifyResult =
  | { ok: true; assertion: SignedAssertion }
  | { ok: false; reason: AssertionFailure; detail: string };

export async function verifyAssertion(
  presented: unknown,
  context: VerifyContext,
  deps: VerifyDeps,
): Promise<VerifyResult> {
  const a = presented as Partial<SignedAssertion> | null;
  const fail = (reason: AssertionFailure, detail: string): VerifyResult => ({ ok: false, reason, detail });

  if (!a || typeof a !== 'object') return fail('malformed', 'no assertion supplied');

  for (const field of ['keyId', 'serviceId', 'approverId', 'action', 'method', 'path', 'requestId'] as const) {
    const value = a[field];
    if (typeof value !== 'string' || !FIELD_PATTERN.test(value)) {
      return fail('malformed', `field ${field} is missing or malformed`);
    }
  }
  if (typeof a.bodyDigest !== 'string' || !DIGEST_PATTERN.test(a.bodyDigest)) {
    return fail('malformed', 'bodyDigest is not a sha256 hex digest');
  }
  if (typeof a.mac !== 'string' || !/^[0-9a-f]{64}$/.test(a.mac)) {
    return fail('malformed', 'mac is not a sha256 hex digest');
  }
  if (!Number.isSafeInteger(a.issuedAt) || !Number.isSafeInteger(a.expiresAt)) {
    return fail('malformed', 'timestamps must be integer milliseconds');
  }

  const fields: AssertionFields = {
    keyId: a.keyId!, serviceId: a.serviceId!, approverId: a.approverId!, action: a.action!,
    method: a.method!, path: a.path!, bodyDigest: a.bodyDigest, issuedAt: a.issuedAt!,
    expiresAt: a.expiresAt!, requestId: a.requestId!,
  };

  const permitted = deps.servicePolicy.get(fields.serviceId);
  if (!permitted) {
    return fail('unknown_service', `service ${fields.serviceId} may not make privileged calls`);
  }
  /*
   * BOUND SERVER-SIDE. The caller does not get to widen its own grant by asking
   * for a different action, and a key is scoped to the job its service does.
   */
  if (!permitted.has(context.expectedAction)) {
    return fail('action_not_granted', `service ${fields.serviceId} is not granted ${context.expectedAction}`);
  }

  /*
   * THE ROUTE'S REQUIREMENT WINS. Comparing against what the assertion CLAIMS
   * would let a signature minted for a harmless action authorize a dangerous
   * one — the signature would verify perfectly and prove the wrong thing.
   */
  if (fields.action !== context.expectedAction) {
    return fail('wrong_action', `assertion is for ${fields.action}, this route requires ${context.expectedAction}`);
  }
  if (fields.method.toUpperCase() !== context.method.toUpperCase() || fields.path !== context.path) {
    return fail('request_mismatch', 'assertion does not match this method and path');
  }
  if (fields.bodyDigest !== sha256Hex(context.rawBody)) {
    return fail('body_mismatch', 'the body does not match the digest that was signed');
  }

  const now = context.now ?? Date.now();
  if (fields.expiresAt <= fields.issuedAt) return fail('malformed', 'expiry must follow issuance');
  if (fields.expiresAt - fields.issuedAt > MAX_ASSERTION_TTL_MS) {
    return fail('ttl_too_long', `a privileged assertion may live at most ${MAX_ASSERTION_TTL_MS}ms`);
  }
  if (now > fields.expiresAt + CLOCK_SKEW_MS) return fail('expired', 'assertion has expired');
  if (now < fields.issuedAt - CLOCK_SKEW_MS) return fail('not_yet_valid', 'assertion is not valid yet');

  const key = deps.keys.get(fields.keyId);
  if (!key) return fail('unknown_key', `key ${fields.keyId} is not active`);

  /*
   * THE MAC IS CHECKED BEFORE THE NONCE IS SPENT. Recording a request id from an
   * unverified assertion would let anyone burn arbitrary ids and block the real
   * operator's next request — replay protection turned into a denial of service.
   */
  if (!macMatches(signAssertion(fields, key), a.mac)) {
    return fail('bad_mac', 'signature does not verify');
  }

  const fresh = await deps.rememberRequestId(fields.requestId, fields.expiresAt + CLOCK_SKEW_MS);
  if (!fresh) return fail('replayed', 'this request id has already been used');

  return { ok: true, assertion: { ...fields, mac: a.mac } };
}
