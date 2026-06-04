import { NextResponse, type NextRequest } from "next/server";

import { getSession } from "../../../../lib/auth";
import { panelQuery } from "../../../../lib/db";
import { queueSftpPasswordReset } from "../../../../lib/modules/hosting-actions";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const siteRows = await panelQuery<{ tenantid: string }>(
    `SELECT "tenantId" AS tenantid FROM websites WHERE id = $1 LIMIT 1`,
    [id],
  );
  const tenantId = siteRows[0]?.tenantid ?? null;
  if (!tenantId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await queueSftpPasswordReset(tenantId, id, { actorUserId: session.email });
  return NextResponse.json({ queued: true, websiteId: id });
}