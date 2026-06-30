// POST /api/pilot/ops/report/export/preview — Phase 12.10. PREVIEW-ONLY redacted report export.
// Accepts either a prebuilt `report` payload or report inputs (built read-only here). Writes no file,
// executes nothing; content is fully redacted via lib/pilot/redaction.ts and fails closed on residual
// secrets. Response itself also passes through safeJson (defense-in-depth).

import { buildReport } from "../../../../../../../lib/pilot/ops-provider";
import { buildReportExportPreview, type ReportExportFormat } from "../../../../../../../lib/pilot/report-export";
import { safeJson } from "../../../../../../../lib/pilot/safe-output";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let b: Record<string, unknown> = {};
  try {
    b = await req.json();
  } catch {
    // validated below
  }
  const format = b.format as ReportExportFormat | undefined;
  const title = typeof b.title === "string" ? b.title : undefined;
  // Use a provided report payload if present; otherwise build one read-only from report inputs.
  const report = b.report !== undefined ? b.report : await buildReport(b as unknown as Parameters<typeof buildReport>[0]);
  return safeJson(buildReportExportPreview({ report, format, title }, new Date().toISOString()));
}
