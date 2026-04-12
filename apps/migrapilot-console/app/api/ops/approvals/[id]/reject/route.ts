import { NextResponse } from "next/server";

import { PILOT_API_BASE, OPS_TOKEN } from "@/lib/shared/pilot-api-config";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (OPS_TOKEN) headers["x-ops-api-token"] = OPS_TOKEN;
    const cookie = request.headers.get("cookie");
    if (cookie) headers["cookie"] = cookie;

    const upstream = await fetch(
      `${PILOT_API_BASE}/api/ops/approvals/${id}/reject`,
      { method: "POST", headers, cache: "no-store" }
    );
    const data = await upstream.json().catch(() => ({ ok: false, error: "upstream returned non-JSON" }));
    return NextResponse.json(data, { status: upstream.status });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
  }
}
