import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/api-auth";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { hashToken } from "@/lib/tokens";

const schema = z.object({
  token: z.string().min(20),
});

export async function POST(request: NextRequest) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return csrfFailure;
  }

  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const actorUserId = authResult.session.user.id;
  const actorEmail = authResult.session.user.email?.toLowerCase();
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  const limiter = await assertRateLimit({
    key: `${actorUserId}:${ip}`,
    action: "org:invite:decline",
    maxAttempts: 30,
    windowSeconds: 60 * 60,
  });

  if (!limiter.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  if (!actorEmail) {
    return NextResponse.json({ error: "Authenticated email is required." }, { status: 400 });
  }

  const invitation = await prisma.orgInvitation.findUnique({
    where: { tokenHash: hashToken(parsed.data.token) },
  });

  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) {
    return NextResponse.json({ error: "Invitation is invalid or expired." }, { status: 400 });
  }

  if (invitation.email !== actorEmail) {
    return NextResponse.json({ error: "Invitation is invalid or expired." }, { status: 400 });
  }

  // Soft-delete by expiring the invitation immediately
  await prisma.orgInvitation.update({
    where: { id: invitation.id },
    data: { expiresAt: new Date(0) },
  });

  await writeAuditLog({
    userId: actorUserId,
    orgId: invitation.orgId,
    action: "ORG_INVITE_DECLINED",
    entityType: "org_invitation",
    entityId: invitation.id,
    ip,
    userAgent,
  });

  return NextResponse.json({ ok: true });
}
