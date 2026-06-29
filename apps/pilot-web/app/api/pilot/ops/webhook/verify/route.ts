// POST /api/pilot/ops/webhook/verify — Phase 11.4. READ-ONLY. Verifies a webhook simulation
// journal record (by url or recordId). Sends nothing; no response body exposed.

import { verifyWebhookSim } from "../../../../../../lib/pilot/ops-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let b: { url?: unknown; recordId?: unknown } = {};
  try {
    b = await req.json();
  } catch {
    // validated below
  }
  return Response.json(await verifyWebhookSim({ url: typeof b.url === "string" && b.url ? b.url : undefined, recordId: typeof b.recordId === "string" && b.recordId ? b.recordId : undefined }));
}
