import { createHmac } from "node:crypto";

import {
  PORTAL_SESSION_COOKIE,
  portalAdminUsername,
  portalSessionToken,
} from "../../../../../lib/shared/portal-auth";
import { PILOT_API_BASE } from "@/lib/shared/pilot-api-config";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const upstream = await fetch(`${PILOT_API_BASE}/api/pilot/chat/stream`, {
      method: "POST",
      cache: "no-store",
      headers: buildHeaders(request.headers),
      body: request.body,
      // @ts-expect-error undici requires duplex for streaming request bodies.
      duplex: "half",
    });

    if (!upstream.body) {
      const text = await upstream.text().catch(() => "upstream error");
      return new Response(text, {
        status: upstream.status,
        headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
      });
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
}

function buildHeaders(incoming: Headers): Record<string, string> {
  const headers: Record<string, string> = {};
  const contentType = incoming.get("content-type");
  if (contentType) headers["content-type"] = contentType;

  const auth = incoming.get("authorization");
  if (auth) {
    headers.authorization = auth;
    return headers;
  }

  const sessionCookie = readCookie(incoming.get("cookie") ?? "", PORTAL_SESSION_COOKIE);
  if (sessionCookie === portalSessionToken()) {
    headers.authorization = `Bearer ${signPortalJwt()}`;
  }

  return headers;
}

function readCookie(cookieHeader: string, name: string): string {
  const pairs = cookieHeader.split(/;\s*/);
  for (const pair of pairs) {
    if (!pair) continue;
    const index = pair.indexOf("=");
    const key = index >= 0 ? pair.slice(0, index) : pair;
    if (key !== name) continue;
    const value = index >= 0 ? pair.slice(index + 1) : "";
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return "";
}

function signPortalJwt(): string {
  const secret = process.env.AUTH_JWT_SECRET ?? process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_JWT_SECRET or JWT_SECRET must be set in production");
    }
    console.warn("[pilot/chat/stream] WARNING: No JWT secret configured — using insecure dev fallback");
  }
  const jwtSecret = secret ?? `dev-fallback-${Date.now()}`;
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: portalAdminUsername(),
    userId: portalAdminUsername(),
    role: "superadmin",
    iat: now,
    exp: now + 60 * 10,
  };

  return signHs256(payload, jwtSecret);
}

function signHs256(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}