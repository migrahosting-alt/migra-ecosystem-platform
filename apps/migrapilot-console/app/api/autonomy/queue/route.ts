import { NextResponse } from "next/server";

import { readAutonomyState } from "../../../../lib/autonomy/store";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const limitRaw = Number(url.searchParams.get("limit") ?? "200");
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 200;

  const state = readAutonomyState();
  const queue = state.queue
    .filter((item) => (status ? item.status === status : true))
    .slice(0, limit);

  return NextResponse.json({
    ok: true,
    data: {
      queue
    }
  });
}
