import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

function deriveSocialEncryptionKey(): Buffer {
  const raw = env.MIGRAMARKET_SOCIAL_CONNECT_ENCRYPTION_KEY || env.LAUNCH_TOKEN_SECRET;
  if (!raw || raw.length < 16) {
    throw new Error("MIGRAMARKET_SOCIAL_CONNECT_ENCRYPTION_KEY is required for social OAuth connections.");
  }

  return createHash("sha256").update(raw).digest();
}

export function encryptSocialSecret(secret: string): string {
  const key = deriveSocialEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function decryptSocialSecret(payload: string): string {
  const [version, ivRaw, tagRaw, ciphertextRaw] = payload.split(":");
  if (version !== "v1" || !ivRaw || !tagRaw || !ciphertextRaw) {
    throw new Error("Invalid encrypted social secret payload.");
  }

  const key = deriveSocialEncryptionKey();
  const iv = Buffer.from(ivRaw, "base64url");
  const tag = Buffer.from(tagRaw, "base64url");
  const ciphertext = Buffer.from(ciphertextRaw, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

export function encryptSocialJson<T>(value: T): string {
  return encryptSocialSecret(JSON.stringify(value));
}

export function decryptSocialJson<T>(payload: string): T {
  return JSON.parse(decryptSocialSecret(payload)) as T;
}
