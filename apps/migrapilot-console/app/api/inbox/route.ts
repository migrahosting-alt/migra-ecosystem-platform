import { NextResponse } from "next/server";

import { PILOT_API_BASE } from "@/lib/shared/pilot-api-config";

export async function GET(request: Request) {
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const cookie = request.headers.get("cookie");
    if (cookie) headers.cookie = cookie;

    const upstream = await fetch(`${PILOT_API_BASE}/api/inbox`, {
      method: "GET",
      headers,
      cache: "no-store",
    });

    const data = await upstream.json().catch(() => ({ ok: false, error: "upstream returned non-JSON" }));
    return NextResponse.json(data, { status: upstream.status });
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error) }, { status: 502 });
  }
}