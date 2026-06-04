import { NextResponse, type NextRequest } from "next/server";

import { getSession } from "../../../../../lib/auth";
import { loadWebsiteCronJobContext, queueWebsiteCronRunNow } from "../../../../../lib/modules/hosting-actions";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string; jobId: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id, jobId } = await context.params;
  if (!id || !jobId) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const current = await loadWebsiteCronJobContext(id, jobId);
  if (!current) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await queueWebsiteCronRunNow(current.tenantId, id, jobId, { actorUserId: session.email });
  return NextResponse.json({ queued: true, id: jobId, websiteId: id });
}