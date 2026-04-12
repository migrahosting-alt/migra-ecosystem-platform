/**
 * pilotProxy — thin server-side proxy to the pilot-api.
 *
 * Usage:
 *   import { pilotProxy } from "@/lib/server/pilotProxy";
 *   export const GET = pilotProxy("/api/autonomy/states");
 *   export const POST = pilotProxy("/api/autonomy/tick", "POST");
 */

const PILOT_API_BASE = (process.env.PILOT_API_URL ?? "http://localhost:3399").replace(/\/$/, "");
const OPS_TOKEN = process.env.OPS_API_TOKEN;

function buildHeaders(incoming?: Headers): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (OPS_TOKEN) {
    headers["x-ops-api-token"] = OPS_TOKEN;
  }
  // Forward auth cookie if present
  const cookie = incoming?.get("cookie");
  if (cookie) headers["cookie"] = cookie;
  const auth = incoming?.get("authorization");
  if (auth) headers["authorization"] = auth;
  return headers;
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export function pilotProxy(path: string, method: Method = "GET") {
  return async function handler(request: Request) {
    const { NextResponse } = await import("next/server");
    try {
      const url = new URL(request.url);
      const target = `${PILOT_API_BASE}${path}${url.search}`;

      const fetchOptions: RequestInit = {
        method,
        headers: buildHeaders(request.headers),
        cache: "no-store",
      };

      if (method !== "GET" && method !== "DELETE") {
        const text = await request.text().catch(() => "");
        if (text) fetchOptions.body = text;
      }

      const upstream = await fetch(target, fetchOptions);
      const data = await upstream.json().catch(() => ({ ok: false, error: "upstream returned non-JSON" }));
      return NextResponse.json(data, { status: upstream.status });
    } catch (err) {
      const { NextResponse } = await import("next/server");
      return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
    }
  };
}
