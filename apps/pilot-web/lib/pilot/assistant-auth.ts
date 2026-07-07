// MigraPilot — AnnouPale-facing assistant bearer-secret auth (P1).
//
// Fail-closed: a missing/empty/invalid secret ALL return not-ok (→ 401 at the route). Uses a
// constant-time compare over sha256 digests so neither the secret's length nor whether a secret is
// configured is leaked (a request with no configured secret and a request with a wrong secret are
// indistinguishable). No secret value is ever logged or returned.

import { createHash, timingSafeEqual } from "node:crypto";

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest();

export function checkAssistantAuth(req: Request): { ok: boolean } {
  const secret = (process.env.MIGRAPILOT_ASSISTANT_SECRET || "").trim();
  const header = (req.headers.get("authorization") || "").trim();
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const provided = match ? match[1].trim() : "";
  if (!secret || !provided) return { ok: false }; // fail closed; no distinction leaked
  // Fixed-length digests → timingSafeEqual never throws and reveals no length side-channel.
  return { ok: timingSafeEqual(sha256(provided), sha256(secret)) };
}

export function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json", "www-authenticate": "Bearer" },
  });
}
