import { NextResponse, type NextRequest } from "next/server";

import { getSession } from "../../../../../lib/auth";
import { loadWebsiteBackupTarget } from "../../../../../lib/modules/hosting-actions";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
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
    return NextResponse.json({ error: "download_unavailable" }, { status: 409 });
  }
  if (!backup.storageUrl) {
    return NextResponse.json({ error: "download_unavailable" }, { status: 404 });
  }

  const destination = new URL(backup.storageUrl, req.url);
  if (destination.protocol !== "http:" && destination.protocol !== "https:") {
    return NextResponse.json({ error: "download_unavailable" }, { status: 409 });
  }

  return NextResponse.redirect(destination);
}