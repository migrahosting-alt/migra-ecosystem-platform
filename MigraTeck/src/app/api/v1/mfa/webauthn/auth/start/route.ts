import { NextRequest, NextResponse } from "next/server";
import { startAuthentication } from "@/lib/security/webauthn";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const userId = typeof body?.userId === "string" ? body.userId : undefined;

  try {
    const { options } = await startAuthentication(userId);
    return NextResponse.json({ ok: true, data: options });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authentication start failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
