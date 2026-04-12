import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { markAsRead, archiveNotification } from "@/lib/notifications";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ notificationId: string }> }
) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const { notificationId } = await params;
  const body = await request.json();

  if (body.action === "read") {
    await markAsRead(auth.session.user.id, notificationId);
  } else if (body.action === "archive") {
    await archiveNotification(auth.session.user.id, notificationId);
  } else {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
