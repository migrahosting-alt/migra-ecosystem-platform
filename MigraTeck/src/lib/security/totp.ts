import { createCipheriv, createDecipheriv, createHmac, createHash, randomBytes } from "node:crypto";
import { env, stepUpTotpDriftWindows } from "@/lib/env";
import { prisma } from "@/lib/prisma";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32Decode(input: string): Buffer {
  const normalized = input.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) {
      throw new Error("Invalid base32 secret.");
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(output);
}

function deriveTotpEncryptionKey(): Buffer {
  const raw = env.STEP_UP_TOTP_ENCRYPTION_KEY;
  if (!raw || raw.length < 16) {
    throw new Error("STEP_UP_TOTP_ENCRYPTION_KEY is required for TOTP step-up.");
  }

  return createHash("sha256").update(raw).digest();
}

export function encryptTotpSecret(secret: string): string {
  const key = deriveTotpEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function decryptTotpSecret(payload: string): string {
  const [version, ivRaw, tagRaw, ciphertextRaw] = payload.split(":");
  if (version !== "v1" || !ivRaw || !tagRaw || !ciphertextRaw) {
    throw new Error("Invalid encrypted TOTP payload.");
  }

  const key = deriveTotpEncryptionKey();
  const iv = Buffer.from(ivRaw, "base64url");
  const tag = Buffer.from(tagRaw, "base64url");
  const ciphertext = Buffer.from(ciphertextRaw, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

function generateCode(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function buildOtpAuthUrl(params: { issuer: string; accountName: string; secret: string }): string {
  const label = encodeURIComponent(`${params.issuer}:${params.accountName}`);
  return `otpauth://totp/${label}?secret=${params.secret}&issuer=${encodeURIComponent(params.issuer)}&digits=6&period=30`;
}

export function verifyTotpCode(secret: string, code: string, now = Date.now()): boolean {
  const normalizedCode = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalizedCode)) {
    return false;
  }

  const step = 30;
  const currentCounter = Math.floor(now / 1000 / step);

  for (let drift = -stepUpTotpDriftWindows; drift <= stepUpTotpDriftWindows; drift += 1) {
    if (generateCode(secret, currentCounter + drift) === normalizedCode) {
      return true;
    }
  }

  return false;
}

/**
 * Verify a TOTP code with replay protection.
 * Records the code hash after successful verification to prevent the same code
 * from being used twice within the drift window.
 */
export async function verifyTotpCodeWithReplayGuard(
  userId: string,
  secret: string,
  code: string,
  now = Date.now(),
): Promise<boolean> {
  if (!verifyTotpCode(secret, code, now)) {
    return false;
  }

  const codeHash = createHash("sha256").update(`${userId}:${code.replace(/\s+/g, "")}`).digest("hex");

  // Check if this code was already used
  const existing = await prisma.totpCodeUsage.findUnique({
    where: { userId_codeHash: { userId, codeHash } },
  });

  if (existing) {
    return false;
  }

  // Record usage — expires after 3 drift windows (90s default)
  const step = 30;
  const ttlSeconds = step * (2 * stepUpTotpDriftWindows + 1);

  await prisma.totpCodeUsage.create({
    data: {
      userId,
      codeHash,
      expiresAt: new Date(now + ttlSeconds * 1000),
    },
  });

  // Probabilistic cleanup of expired records (5% chance)
  if (Math.random() < 0.05) {
    prisma.totpCodeUsage.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});
  }

  return true;
}
