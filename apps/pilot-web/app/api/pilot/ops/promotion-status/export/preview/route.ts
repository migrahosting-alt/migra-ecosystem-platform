// POST /api/pilot/ops/promotion-status/export/preview — Phase 12.17. PREVIEW-ONLY redacted export of
// the executor promotion-gate status, reusing the report-export engine. Writes no file, executes
// nothing; eligibleForExecution/executed/written stay false; fails closed on residual secrets.

import { buildPromotionStatus } from "../../../../../../../lib/pilot/promotion-status";
import { buildReportExportPreview, type ReportExportFormat } from "../../../../../../../lib/pilot/report-export";
import { safeJson } from "../../../../../../../lib/pilot/safe-output";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let b: { format?: unknown; title?: unknown } = {};
  try {
    b = await req.json();
  } catch {
    // defaults below
  }
  const now = new Date().toISOString();
  const status = buildPromotionStatus(now);
  return safeJson(buildReportExportPreview({
    report: status,
    format: b.format as ReportExportFormat | undefined,
    title: typeof b.title === "string" ? b.title : "MigraPilot Promotion Gate Status",
  }, now));
}
