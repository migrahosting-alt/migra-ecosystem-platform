import { NextResponse } from "next/server";

import { readAutonomyState } from "../../../../lib/autonomy/store";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 100;
  const classification = url.searchParams.get("classification");

  const state = readAutonomyState();
  const findings = state.findings
    .filter((item) => {
      if (!classification) {
        return true;
      }
      return item.classification === classification;
    })
    .slice(0, limit);

  return NextResponse.json({
    ok: true,
    data: {
      findings
    }
  });
}
