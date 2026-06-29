// GET /api/pilot/ops/webhook/recent — Phase 11.4. READ-ONLY recent webhook simulation records
// from the action journal (sanitized; no response bodies), with the active storage mode.

import { actionJournalStoreName } from "../../../../../../lib/pilot/ops-action-journal";
import { listWebhookSimRecords } from "../../../../../../lib/pilot/ops-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const raw = Number(new URL(req.url).searchParams.get("limit"));
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(50, Math.floor(raw)) : 20;
  const records = await listWebhookSimRecords(limit);
  return Response.json({ store: actionJournalStoreName(), enabled: process.env.PILOT_WEBHOOK_SIM_ENABLED === "1" || process.env.PILOT_WEBHOOK_SIM_ENABLED === "true", count: records.length, records });
}
