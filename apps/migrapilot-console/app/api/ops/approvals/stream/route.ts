/**
 * GET /api/ops/approvals/stream
 *
 * Streaming SSE proxy to the pilot-api approval event stream.
 * Does NOT buffer through JSON — pipes the upstream body directly so that
 * text/event-stream reaches the browser intact.
 *
 * Auth: session cookie + OPS_API_TOKEN forwarded identically to pilotProxy.
 */

import { PILOT_API_BASE, OPS_TOKEN } from "@/lib/shared/pilot-api-config";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const upstream = await fetch(
      `${PILOT_API_BASE}/api/ops/approvals/stream?${searchParams.toString()}`,
      {
        method: "GET",
        cache: "no-store",
        headers: buildHeaders(request.headers),
        // @ts-expect-error — node-fetch / undici: keep body streaming
        duplex: "half",
      }
    );

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "upstream error");
      return new Response(JSON.stringify({ ok: false, error: text }), {
        status: upstream.status,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
}

function buildHeaders(incoming: Headers): Record<string, string> {
  const headers: Record<string, string> = {};
  if (OPS_TOKEN) headers["x-ops-api-token"] = OPS_TOKEN;
  const cookie = incoming.get("cookie");
  if (cookie) headers["cookie"] = cookie;
  const auth = incoming.get("authorization");
  if (auth) headers["authorization"] = auth;
  return headers;
}
