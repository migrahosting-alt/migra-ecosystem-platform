// POST /api/pilot/ops/promotion-evidence/export/preview — Phase 12.19. PREVIEW-ONLY redacted export of
// the promotion evidence bundle, reusing the report-export engine. Writes no file, executes nothing;
// eligibleForExecution/executed/written stay false; fails closed on residual secrets.

import { buildPromotionEvidenceBundle } from "../../../../../../../lib/pilot/promotion-evidence";
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
  const bundle = buildPromotionEvidenceBundle(now);
  return safeJson(buildReportExportPreview({
    report: bundle,
    format: b.format as ReportExportFormat | undefined,
    title: typeof b.title === "string" ? b.title : "MigraPilot Promotion Evidence Bundle",
  }, now));
}
