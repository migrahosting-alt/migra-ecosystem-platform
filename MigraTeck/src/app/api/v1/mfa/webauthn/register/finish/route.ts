import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { writeAuditLog } from "@/lib/audit";
import { getClientIp, getUserAgent } from "@/lib/request";
import { finishRegistration } from "@/lib/security/webauthn";
import { recordSecurityEvent } from "@/lib/security/security-events";

export async function POST(request: NextRequest) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const friendlyName = typeof body.friendlyName === "string" ? body.friendlyName : null;

  try {
    const result = await finishRegistration(auth.session.user.id, body, friendlyName);

    await writeAuditLog({
      actorId: auth.session.user.id,
      action: "MFA_PASSKEY_REGISTERED",
      entityType: "UserPasskey",
      entityId: result.passkeyId,
      ip: getClientIp(request),
      userAgent: getUserAgent(request),
    });

    await recordSecurityEvent({
      userId: auth.session.user.id,
      eventType: "PASSKEY_REGISTERED",
      ip: getClientIp(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Registration verification failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
