import { NextResponse } from "next/server";

import { readChatSettings, writeChatSettings } from "@/lib/server/chat-settings";
import type { ChatSettings } from "@/lib/shared/chat-settings";

export async function GET() {
  return NextResponse.json({ ok: true, data: readChatSettings() });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Partial<ChatSettings> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "INVALID_BODY" }, { status: 400 });
  }

  const settings = writeChatSettings(body);
  return NextResponse.json({ ok: true, data: settings });
}
