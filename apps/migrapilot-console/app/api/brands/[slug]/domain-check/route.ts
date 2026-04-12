import { NextResponse } from "next/server";

import { PILOT_API_BASE } from "@/lib/shared/pilot-api-config";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  try {
    const res = await fetch(`${PILOT_API_BASE}/api/brands/${slug}/domain-check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({ ok: false, error: "non-JSON response" }));
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 502 });
  }
}
