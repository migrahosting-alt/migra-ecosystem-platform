import { NextResponse } from "next/server";

import { PILOT_API_BASE, OPS_TOKEN } from "@/lib/shared/pilot-api-config";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (OPS_TOKEN) headers["x-ops-api-token"] = OPS_TOKEN;
    const cookie = request.headers.get("cookie");
    if (cookie) headers["cookie"] = cookie;

    const upstream = await fetch(
      `${PILOT_API_BASE}/api/ops/releases/${runId}`,
      { method: "GET", headers, cache: "no-store" }
    );
    const data = await upstream.json().catch(() => ({ ok: false, error: "upstream returned non-JSON" }));
    return NextResponse.json(data, { status: upstream.status });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
  }
}
