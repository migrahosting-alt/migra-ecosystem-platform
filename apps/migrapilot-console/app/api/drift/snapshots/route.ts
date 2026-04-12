import { NextResponse } from "next/server";

import { listDriftSnapshots, parseClassification } from "../../../../lib/drift/service";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const environment = url.searchParams.get("env") ?? undefined;
  const classification = parseClassification(url.searchParams.get("classification") ?? "all");
  const limitRaw = Number(url.searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 500)) : 100;

  const snapshots = await listDriftSnapshots({
    environment,
    classification,
    limit
  });

  return NextResponse.json({
    ok: true,
    data: {
      snapshots
    }
  });
}
