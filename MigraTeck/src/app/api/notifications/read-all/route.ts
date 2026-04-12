import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { markAllAsRead } from "@/lib/notifications";

export async function POST() {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  await markAllAsRead(auth.session.user.id);
  return NextResponse.json({ ok: true });
}
