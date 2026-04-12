/**
 * MFA module — TOTP enrollment and verification.
 * Uses SHA-1 based TOTP (RFC 6238) with 6-digit codes, 30s steps.
 * Challenge-based flow: enroll returns challenge_id, verify consumes it.
 */
import { createHmac, randomBytes } from "node:crypto";
import { db } from "../../lib/db.js";
import { hashToken, generateToken } from "../../lib/crypto.js";

const TOTP_PERIOD = 30;
const TOTP_DIGITS = 6;
const TOTP_ALGORITHM = "sha1";
const TOTP_WINDOW = 1; // Allow 1 step drift
const CHALLENGE_TTL_S = 600; // 10 minutes

// ── TOTP generation ─────────────────────────────────────────────────

function generateTotpSecret(): string {
  return randomBytes(20).toString("base64url");
}

function base32Encode(buffer: Buffer): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const byte of buffer) {
    bits += byte.toString(2).padStart(8, "0");
  }
  let result = "";
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, "0");
    result += alphabet[parseInt(chunk, 2)]!;
  }
  return result;
}

function computeTotp(secret: string, counter: number): string {
  const secretBuf = Buffer.from(secret, "base64url");
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac(TOTP_ALGORITHM, secretBuf);
  hmac.update(counterBuf);
  const hash = hmac.digest();

  const offset = hash[hash.length - 1]! & 0x0f;
  const code =
    ((hash[offset]! & 0x7f) << 24) |
    ((hash[offset + 1]! & 0xff) << 16) |
    ((hash[offset + 2]! & 0xff) << 8) |
    (hash[offset + 3]! & 0xff);

  return (code % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, "0");
}

function verifyTotpCode(
  secret: string,
  code: string,
  timestamp = Date.now(),
): boolean {
  const counter = Math.floor(timestamp / 1000 / TOTP_PERIOD);
  for (let i = -TOTP_WINDOW; i <= TOTP_WINDOW; i++) {
    if (computeTotp(secret, counter + i) === code) return true;
  }
  return false;
}

// ── Enrollment ──────────────────────────────────────────────────────

export interface TotpEnrollmentResult {
  challengeId: string;
  secret: string;
  otpauthUri: string;
  recoveryCodes: string[];
}

export async function enrollTotp(
  userId: string,
  userEmail: string,
): Promise<TotpEnrollmentResult> {
  // Check if already enrolled
  const existing = await db.userCredential.findFirst({
    where: { userId, type: "TOTP", isEnabled: true },
  });
  if (existing) {
    const meta = existing.metadata as Record<string, unknown>;
    if (meta["confirmed"] === true) throw new Error("TOTP already enrolled");
  }

  const secret = generateTotpSecret();
  const secretBuf = Buffer.from(secret, "base64url");
  const base32Secret = base32Encode(secretBuf);

  const otpauthUri = `otpauth://totp/MigraTeck:${encodeURIComponent(userEmail)}?secret=${base32Secret}&issuer=MigraTeck&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD}`;

  // Store (or replace pending) credential
  if (existing) {
    await db.userCredential.update({
      where: { id: existing.id },
      data: { secretHash: secret, metadata: { confirmed: false } },
    });
  } else {
    await db.userCredential.create({
      data: {
        userId,
        type: "TOTP",
        secretHash: secret,
        metadata: { confirmed: false },
        priority: 0,
        isEnabled: true,
      },
    });
  }

  // Create challenge row
  const challengeSecret = generateToken(32);
  const challengeHash = hashToken(challengeSecret);
  const challenge = await db.mfaChallenge.create({
    data: {
      userId,
      method: "totp",
      challengeHash,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_S * 1000),
    },
  });

  // Generate recovery codes
  const recoveryCodes = generateRecoveryCodes(10);
  await storeRecoveryCodes(userId, recoveryCodes);

  return {
    challengeId: challenge.id,
    secret: base32Secret,
    otpauthUri,
    recoveryCodes,
  };
}

export async function confirmTotpEnrollment(
  userId: string,
  code: string,
  challengeId?: string,
): Promise<boolean> {
  // Validate challenge if provided
  if (challengeId) {
    const challenge = await db.mfaChallenge.findFirst({
      where: { id: challengeId, userId, method: "totp", verifiedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!challenge) return false;
  }

  const cred = await db.userCredential.findFirst({
    where: { userId, type: "TOTP", isEnabled: true },
  });
  if (!cred || !cred.secretHash) return false;

  const meta = cred.metadata as Record<string, unknown>;
  if (meta["confirmed"] === true) return false;

  if (!verifyTotpCode(cred.secretHash, code)) return false;

  await db.userCredential.update({
    where: { id: cred.id },
    data: { metadata: { confirmed: true } },
  });

  // Mark challenge as verified
  if (challengeId) {
    await db.mfaChallenge.update({
      where: { id: challengeId },
      data: { verifiedAt: new Date() },
    });
  }

  return true;
}

export async function verifyTotp(
  userId: string,
  code: string,
): Promise<boolean> {
  const cred = await db.userCredential.findFirst({
    where: { userId, type: "TOTP", isEnabled: true },
  });
  if (!cred || !cred.secretHash) return false;

  const meta = cred.metadata as Record<string, unknown>;
  if (meta["confirmed"] !== true) return false;

  return verifyTotpCode(cred.secretHash, code);
}

export async function disableTotp(userId: string): Promise<boolean> {
  const cred = await db.userCredential.findFirst({
    where: { userId, type: "TOTP" },
  });
  if (!cred) return false;

  await db.userCredential.delete({ where: { id: cred.id } });
  return true;
}

export async function hasTotpEnabled(userId: string): Promise<boolean> {
  const cred = await db.userCredential.findFirst({
    where: { userId, type: "TOTP", isEnabled: true },
  });
  if (!cred) return false;
  const meta = cred.metadata as Record<string, unknown>;
  return meta["confirmed"] === true;
}

// ── Recovery Codes ──────────────────────────────────────────────────

export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const buf = randomBytes(5);
    codes.push(buf.toString("hex").match(/.{5}/g)!.join("-"));
  }
  return codes;
}

export async function storeRecoveryCodes(
  userId: string,
  codes: string[],
): Promise<void> {
  const hashed = codes.map(hashToken);
  // Remove existing recovery codes first
  await db.userCredential.deleteMany({
    where: { userId, type: "RECOVERY_CODE" },
  });
  await db.userCredential.create({
    data: {
      userId,
      type: "RECOVERY_CODE",
      metadata: { codes: hashed },
      priority: 0,
      isEnabled: true,
    },
  });
}

export async function consumeRecoveryCode(
  userId: string,
  code: string,
): Promise<boolean> {
  const cred = await db.userCredential.findFirst({
    where: { userId, type: "RECOVERY_CODE" },
  });
  if (!cred) return false;

  const meta = cred.metadata as Record<string, unknown>;
  const storedCodes = meta["codes"] as string[];
  const codeHash = hashToken(code.replace(/-/g, ""));

  const idx = storedCodes.indexOf(codeHash);
  if (idx === -1) return false;

  // Remove used code
  storedCodes.splice(idx, 1);
  await db.userCredential.update({
    where: { id: cred.id },
    data: { metadata: { codes: storedCodes } },
  });

  return true;
}
