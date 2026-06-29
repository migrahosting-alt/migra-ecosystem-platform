// POST /api/pilot/ops/report/generate — Phase 10.8. READ-ONLY ops evidence report.
// Response-only: returns report content, writes NO file, executes nothing, mutates nothing.

import { buildReport } from "../../../../../../lib/pilot/ops-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let b: Record<string, unknown> = {};
  try {
    b = await req.json();
  } catch {
    // validated below
  }
  return Response.json(await buildReport(b as unknown as Parameters<typeof buildReport>[0]));
}
