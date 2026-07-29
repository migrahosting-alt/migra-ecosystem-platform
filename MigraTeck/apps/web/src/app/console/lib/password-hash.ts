/**
 * Console password-hash format and verification.
 *
 * Split out of `auth.ts` so the parser can be tested against the format its own
 * documentation prescribes. `auth.ts` imports `next/headers` and cannot be loaded in a
 * unit test; this module imports only node:crypto.
 *
 * SCOPE. This is the local hash check for the env-configured console admin
 * (CONSOLE_ADMIN_PASSWORD_HASH). It is NOT a general credential service and must not
 * become one — if auth-api owns password verification for a login path, that path uses
 * auth-api, not this.
 */

import crypto from "node:crypto";

/** Colon, deliberately: the value lives in env files and systemd units, where `$` expands. */
export const HASH_SEPARATOR = ":";
export const HASH_ALGORITHM = "scrypt";
export const SCRYPT_KEYLEN = 64;

/** `scrypt:<saltHex>:<hashHex>` — the one format this module reads or writes. */
export const formatScryptHash = (saltHex: string, hashHex: string): string =>
  [HASH_ALGORITHM, saltHex, hashHex].join(HASH_SEPARATOR);

/**
 * Constant-time verification of `plain` against a stored `scrypt:<salt>:<hash>` value.
 *
 * Fails closed on every malformed input — wrong separator, wrong algorithm, wrong field
 * count, non-hex, unusable salt — and never throws.
 */
export const verifyScryptHash = (plain: string, stored: string): boolean => {
  const parts = (stored ?? "").split(HASH_SEPARATOR);
  if (parts.length !== 3 || parts[0] !== HASH_ALGORITHM) return false;

  const salt = Buffer.from(parts[1]!, "hex");
  const expected = Buffer.from(parts[2]!, "hex");
  // Buffer.from ignores trailing garbage on invalid hex, so an empty result is the only
  // reliable signal that the field was not hex at all.
  if (salt.length === 0 || expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN);
  } catch {
    return false;
  }
  // timingSafeEqual throws on a length mismatch, so the length check must precede it — and
  // a length mismatch is not secret, it means the stored hash is the wrong shape.
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
};
