import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { startRegistration } from "@/lib/security/webauthn";

export async function POST() {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const user = auth.session.user;

  try {
    const options = await startRegistration(user.id, user.email ?? "", user.name);
    return NextResponse.json({ ok: true, data: options });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Registration start failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
