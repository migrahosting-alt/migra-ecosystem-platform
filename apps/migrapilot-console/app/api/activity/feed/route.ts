import { NextResponse } from "next/server";

import { listActivity } from "../../../../lib/activity/store";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? "100") || 100));

  const events = listActivity(limit);
  return NextResponse.json({ ok: true, data: { events } });
}
