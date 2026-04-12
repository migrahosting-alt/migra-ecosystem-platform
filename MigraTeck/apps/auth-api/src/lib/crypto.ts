/**
 * Cryptographic helpers for MigraAuth.
 * Token generation, hashing, PKCE verification.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Generate a cryptographically random URL-safe token. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** SHA-256 hash a token for storage. Never store raw tokens. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time comparison of two hex strings. */
export function verifyTokenHash(token: string, storedHash: string): boolean {
  const computed = hashToken(token);
  if (computed.length !== storedHash.length) return false;
  return timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(storedHash, "hex"));
}

/** Verify PKCE S256 code challenge. */
export function verifyCodeChallenge(
  codeVerifier: string,
  codeChallenge: string,
): boolean {
  const computed = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  if (computed.length !== codeChallenge.length) return false;
  return timingSafeEqual(
    Buffer.from(computed),
    Buffer.from(codeChallenge),
  );
}

/** Generate a 6-digit numeric code. */
export function generateNumericCode(): string {
  const buf = randomBytes(4);
  const num = buf.readUInt32BE() % 1_000_000;
  return num.toString().padStart(6, "0");
}
