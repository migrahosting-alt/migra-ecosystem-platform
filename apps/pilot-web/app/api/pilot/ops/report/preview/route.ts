// POST /api/pilot/ops/report/preview — Phase 10.8. READ-ONLY report-input preview. Writes nothing.

import { previewReport } from "../../../../../../lib/pilot/ops-provider";
import { safeJson } from "../../../../../../lib/pilot/safe-output";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let b: Record<string, unknown> = {};
  try {
    b = await req.json();
  } catch {
    // validated below
  }
  return safeJson(previewReport(b as unknown as Parameters<typeof previewReport>[0]));
}
