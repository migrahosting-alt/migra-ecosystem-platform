// POST /api/pilot/image/preview — Phase 9.7. Validate + normalize a request WITHOUT submitting it.

import { imagePreview } from "../../../../../lib/pilot/image-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // handled by validation below
  }
  const r = imagePreview(body);
  return Response.json(r, { status: r.ok ? 200 : 400 });
}
