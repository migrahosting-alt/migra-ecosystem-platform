/**
 * SEALING A THIRD-PARTY BEARER CREDENTIAL AT REST.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHY THIS IS NOT "THE DATABASE ALREADY HOLDS SENSITIVE THINGS"
 *
 * It does — conversations, documents, project state. The argument for
 * encrypting a refresh token anyway is that it is a different KIND of thing:
 *
 *   • It is a credential to a system that is not ours. It opens the user's
 *     actual Gmail, from anywhere, with no Migra process involved.
 *   • It outlives our own controls. Changing a Migra password, disabling a
 *     Migra account, or revoking a Migra session does nothing to it.
 *   • It does not expire on its own.
 *
 * So a dump of the durable store — a backup on a laptop, a snapshot restored
 * into staging, a replica someone forgot — is a permanent key to every
 * connected mailbox. Encrypting with a key held OUTSIDE the database makes the
 * dump insufficient on its own. That is the whole claim: not "encryption is
 * good practice", but "a stolen backup must not be a mailbox".
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE ADDITIONAL DATA IS THE POINT, NOT A DETAIL
 *
 * GCM's associated data binds a ciphertext to the row it belongs in. Without
 * it, encryption alone stops a READER of the database and does nothing about a
 * WRITER: an attacker connects their own mailbox, copies their own sealed
 * refresh token into a victim's row, and every "my email" question the victim
 * asks then reads the attacker's inbox — while anything drafted goes out from
 * it.
 *
 * That is the same graft attack the callback's principal check refuses,
 * arriving through the storage layer instead of the browser. The scope, the
 * provider, the provider account id and the purpose are all authenticated, so
 * a ciphertext moved to another row, another user, or the other token column
 * fails to open at all.
 *
 * ---------------------------------------------------------------------------
 * 🚨 A SEAL THAT WILL NOT OPEN IS AN OPERATOR FAULT, NOT A USER FAULT
 *
 * If the key is wrong or missing, every connection in the deployment fails to
 * open. The tempting classification is `authorization_expired` — the state
 * that already exists for "the grant stopped working" — and it would be
 * exactly wrong: it tells the user to reconnect, and reconnecting OVERWRITES a
 * perfectly good row to work around a misconfigured environment variable. By
 * the time someone fixes the key, the evidence is gone.
 *
 * `unreadable` is therefore its own outcome, and it reports a deployment
 * problem to an operator rather than a reconnect prompt to a user.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 32 raw bytes, base64. Held outside the database — that is its whole job. */
export const MAIL_TOKEN_KEY_ENV = 'MIGRAPILOT_MAIL_TOKEN_KEY';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96 bits: the size GCM is defined for.
const KEY_BYTES = 32;

/**
 * Which token a ciphertext is. Authenticated, so an access-token ciphertext
 * cannot be pasted into the refresh column to make a short-lived credential
 * look like a durable one (or the reverse, which would silently break refresh).
 */
export type SealPurpose = 'access_token' | 'refresh_token';

/**
 * What a ciphertext is bound to. Every field is authenticated; changing any of
 * them makes the seal fail to open.
 */
export interface SealBinding {
  ownerScope: string;
  workspaceScope: string;
  provider: string;
  /** The provider's stable account id — not the display address, which moves. */
  providerAccountId: string;
  purpose: SealPurpose;
}

export interface SealedValue {
  /** Which key sealed this, so a key can be rotated without a flag day. */
  keyId: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

export type SealKeyProblem =
  | { kind: 'missing' }
  | { kind: 'malformed' }
  | { kind: 'wrong_length'; actual: number };

export interface SealKey {
  id: string;
  /** Kept out of the public shape below so a key cannot be logged by accident. */
  readonly material: Buffer;
}

/**
 * Derive a short, non-reversible id for a key.
 *
 * A truncated hash of the key material, so two deployments with the same key
 * agree on the id without the id revealing anything about the key. It exists to
 * answer "was this sealed with the key I have?" — which is the difference
 * between "rotate" and "your environment is wrong".
 */
export function keyIdFor(material: Buffer): string {
  return createHash('sha256').update(material).digest('hex').slice(0, 16);
}

/** Read and validate the key. Refuses rather than degrading to plaintext. */
export function sealKeyFrom(
  env: Record<string, string | undefined>,
): { ok: true; key: SealKey } | { ok: false; problem: SealKeyProblem } {
  const raw = env[MAIL_TOKEN_KEY_ENV]?.trim();
  if (!raw) return { ok: false, problem: { kind: 'missing' } };

  let material: Buffer;
  try {
    material = Buffer.from(raw, 'base64');
  } catch {
    return { ok: false, problem: { kind: 'malformed' } };
  }
  /*
   * Buffer.from(..., 'base64') does not throw on garbage — it silently drops
   * invalid characters and returns a SHORT buffer. Without this length check a
   * typo'd key would produce a 7-byte key, and `createCipheriv` would be the
   * thing that noticed, at the first connection attempt.
   */
  if (material.length !== KEY_BYTES) {
    return { ok: false, problem: { kind: 'wrong_length', actual: material.length } };
  }
  return { ok: true, key: { id: keyIdFor(material), material } };
}

/** Serialise the binding so seal and open cannot disagree about its shape. */
function additionalData(binding: SealBinding): Buffer {
  /*
   * Field NAMES are included, and the separator cannot appear in a field
   * because each value is length-prefixed. Concatenating raw values would let
   * two different bindings produce identical additional data — an owner of
   * "a" with account "bc" matching an owner of "ab" with account "c" — and a
   * ciphertext would then move between them undetected.
   */
  const parts = [
    ['owner', binding.ownerScope],
    ['workspace', binding.workspaceScope],
    ['provider', binding.provider],
    ['account', binding.providerAccountId],
    ['purpose', binding.purpose],
  ] as const;
  return Buffer.from(parts.map(([k, v]) => `${k}:${v.length}:${v}`).join('|'), 'utf8');
}

/** Seal a token value against a binding. */
export function seal(key: SealKey, binding: SealBinding, plaintext: string): SealedValue {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key.material, iv);
  cipher.setAAD(additionalData(binding));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    keyId: key.id,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export type OpenResult =
  | { ok: true; value: string }
  /**
   * The stored ciphertext was sealed by a different key. Distinct from
   * `unreadable` because the remedy differs: this one names rotation.
   */
  | { ok: false; reason: 'wrong_key'; sealedWith: string }
  /** Tampered, moved between rows, or the key is wrong. Never a user prompt. */
  | { ok: false; reason: 'unreadable' };

/**
 * Open a sealed value, or classify why not.
 *
 * Returns rather than throws: a failure here is a state the caller must handle
 * deliberately, and an exception would be caught by some generic handler and
 * reported as a provider problem.
 */
export function open(key: SealKey, binding: SealBinding, sealed: SealedValue): OpenResult {
  if (!constantTimeEqualStrings(sealed.keyId, key.id)) {
    return { ok: false, reason: 'wrong_key', sealedWith: sealed.keyId };
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, key.material, Buffer.from(sealed.iv, 'base64'));
    decipher.setAAD(additionalData(binding));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return { ok: true, value: plaintext.toString('utf8') };
  } catch {
    /*
     * `final()` throws when the tag does not verify — which is the SAME signal
     * for tampering, for a ciphertext moved to another row, and for a wrong
     * key. The exception is not propagated: it carries buffer contents in some
     * Node versions, and this is the one place holding a decrypted credential.
     */
    return { ok: false, reason: 'unreadable' };
  }
}

function constantTimeEqualStrings(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}

/** What an operator is told when the key is unusable. Never the key. */
export function sealKeyProblemMessage(problem: SealKeyProblem): string {
  switch (problem.kind) {
    case 'missing':
      return `${MAIL_TOKEN_KEY_ENV} is not set. Email connections cannot be stored without it.`;
    case 'malformed':
      return `${MAIL_TOKEN_KEY_ENV} is not valid base64.`;
    case 'wrong_length':
      // The LENGTH is safe to state and is the whole diagnosis; the value is
      // not, and a truncated base64 key is the realistic mistake.
      return `${MAIL_TOKEN_KEY_ENV} must decode to 32 bytes; it decodes to ${problem.actual}.`;
  }
}
