import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { listNotifications, getUnreadCount } from "@/lib/notifications";

export async function GET(request: NextRequest) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const status = url.searchParams.get("status") as "UNREAD" | "READ" | "ARCHIVED" | null;
  const category = url.searchParams.get("category");
  const limit = url.searchParams.get("limit");
  const cursor = url.searchParams.get("cursor");

  const [result, unreadCount] = await Promise.all([
    listNotifications({
      userId: auth.session.user.id,
      ...(status ? { status } : {}),
      ...(category ? { category } : {}),
      ...(limit ? { limit: parseInt(limit, 10) } : {}),
      ...(cursor ? { cursor } : {}),
    }),
    getUnreadCount(auth.session.user.id),
  ]);

  return NextResponse.json({
    items: result.items,
    nextCursor: result.nextCursor,
    unreadCount,
  });
}
