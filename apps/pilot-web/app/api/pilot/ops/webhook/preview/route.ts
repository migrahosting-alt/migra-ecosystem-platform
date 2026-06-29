// POST /api/pilot/ops/webhook/preview — Phase 11.4. READ-ONLY. Validates URL allowlist + sanitizes
// payload. Sends nothing. Sending is approval-gated (chat flow).

import { previewWebhookSim } from "../../../../../../lib/pilot/ops-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let b: { url?: unknown; payload?: unknown } = {};
  try {
    b = await req.json();
  } catch {
    // validated below
  }
  return Response.json(previewWebhookSim({ url: typeof b.url === "string" ? b.url : "", payload: b.payload }));
}
