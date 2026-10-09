import { NextResponse, type NextRequest } from "next/server";

import { getSession } from "../../../../../lib/auth";
import { loadWebsiteBackupTarget, queueBackupRestore } from "../../../../../lib/modules/hosting-actions";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string; backupId: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id, backupId } = await context.params;
  if (!id || !backupId) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const backup = await loadWebsiteBackupTarget(id, backupId);
  if (!backup) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (backup.status !== "success") {
    return NextResponse.json({ error: "backup_not_restorable" }, { status: 409 });
  }

  await queueBackupRestore(backup.tenantId, id, backupId, { actorUserId: session.email });
  return NextResponse.json({ queued: true, websiteId: id, backupId });
}