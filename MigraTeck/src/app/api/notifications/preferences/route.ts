import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getNotificationPreferences, upsertPreference } from "@/lib/notifications";
import { NotificationChannel } from "@prisma/client";

export async function GET() {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const preferences = await getNotificationPreferences(auth.session.user.id);
  return NextResponse.json({ preferences });
}

export async function PUT(request: NextRequest) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const body = await request.json();

  if (!body.category || !body.channel || typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "category, channel, and enabled are required" }, { status: 400 });
  }

  const validChannels: NotificationChannel[] = ["IN_APP", "EMAIL", "SMS", "WEBHOOK"];
  if (!validChannels.includes(body.channel)) {
    return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
  }

  const pref = await upsertPreference(
    auth.session.user.id,
    body.category,
    body.channel,
    body.enabled
  );

  return NextResponse.json({ preference: pref });
}
