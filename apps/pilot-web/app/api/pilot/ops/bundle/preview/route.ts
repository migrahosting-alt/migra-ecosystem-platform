// POST /api/pilot/ops/bundle/preview — Phase 10.9. READ-ONLY: lists planned bundle checks. Runs nothing.

import { previewHealthBundle } from "../../../../../../lib/pilot/ops-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let b: Record<string, unknown> = {};
  try {
    b = await req.json();
  } catch {
    // validated below
  }
  return Response.json(previewHealthBundle(b as unknown as Parameters<typeof previewHealthBundle>[0]));
}
