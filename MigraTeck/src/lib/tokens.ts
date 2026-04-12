import { createHash, randomBytes } from "crypto";

export function generateToken(size = 32): string {
  return randomBytes(size).toString("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
