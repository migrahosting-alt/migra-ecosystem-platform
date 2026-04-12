import { randomBytes } from "node:crypto";
import { env } from "@/lib/env";
import { hashToken } from "@/lib/tokens";

export function generateInvitationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashToken(token),
  };
}

export function buildInvitationLink(token: string): string {
  const baseUrl = env.NEXTAUTH_URL || "http://localhost:3000";
  return `${baseUrl.replace(/\/$/, "")}/invite?token=${encodeURIComponent(token)}`;
}
