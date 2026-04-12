import { MembershipStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { assertPermission } from "@/lib/authorization";
import { writeAuditLog } from "@/lib/audit";
import { isMagicLinkEnabled } from "@/lib/env";
import { buildInvitationLink, generateInvitationToken } from "@/lib/invitations";
import { isSmtpConfigured, sendMail } from "@/lib/mail";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { assertMutationSecurity } from "@/lib/security/mutation-guard";
import { OperatorRiskError } from "@/lib/security/operator-risk";
import { PlatformLockdownError } from "@/lib/security/platform-lockdown";
import { assertRateLimit } from "@/lib/security/rate-limit";

export async function POST(request: NextRequest, context: { params: Promise<{ orgId: string; id: string }> }) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return csrfFailure;
  }

  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { orgId, id } = await context.params;
  const actorUserId = authResult.session.user.id;
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  const membership = await prisma.membership.findFirst({
    where: {
      userId: actorUserId,
      orgId,
      status: MembershipStatus.ACTIVE,
    },
    include: {
      org: {
        select: { name: true },
      },
    },
  });

  if (!membership) {
    await writeAuditLog({
      userId: actorUserId,
      orgId,
      action: "AUTHZ_PERMISSION_DENIED",
      entityType: "permission",
      entityId: "org:invite:manage",
      ip,
      userAgent,
      metadata: {
        route: "/api/orgs/[orgId]/invites/[id]/resend",
        reason: "missing_membership",
      },
    });

    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await assertMutationSecurity({
      action: "org:invite:resend",
      actorUserId,
      actorRole: membership.role,
      orgId,
      riskTier: 1,
      ip,
      userAgent,
      route: "/api/orgs/[orgId]/invites/[id]/resend",
    });
  } catch (error) {
    if (error instanceof PlatformLockdownError || error instanceof OperatorRiskError) {
      return NextResponse.json({ error: "Provisioning is temporarily unavailable." }, { status: error.httpStatus });
    }

    return NextResponse.json({ error: "Provisioning is temporarily unavailable." }, { status: 503 });
  }

  const allowed = await assertPermission({
    actorUserId,
    orgId,
    role: membership.role,
    action: "org:invite:manage",
    route: "/api/orgs/[orgId]/invites/[id]/resend",
    ip,
    userAgent,
  });

  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limiter = await assertRateLimit({
    key: `${actorUserId}:${orgId}:${ip}`,
    action: "org:invite:create",
    maxAttempts: 30,
    windowSeconds: 60 * 60,
  });

  if (!limiter.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } },
    );
  }

  const invitation = await prisma.orgInvitation.findFirst({
    where: {
      id,
      orgId,
      acceptedAt: null,
    },
  });

  if (!invitation) {
    return NextResponse.json({ error: "Invitation not found." }, { status: 404 });
  }

  const { token, tokenHash } = generateInvitationToken();
  const inviteLink = buildInvitationLink(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await prisma.orgInvitation.update({
    where: { id: invitation.id },
    data: {
      tokenHash,
      expiresAt,
    },
  });

  const emailEnabled = isSmtpConfigured() && isMagicLinkEnabled;
  let emailSent = false;

  if (emailEnabled) {
    emailSent = await sendMail({
      to: invitation.email,
      subject: `Invitation reminder for ${membership.org.name}`,
      text: `You were invited to join ${membership.org.name}. Accept: ${inviteLink}`,
      html: `<p>You were invited to join <strong>${membership.org.name}</strong>.</p><p><a href="${inviteLink}">Accept invitation</a></p>`,
    });
  }

  await writeAuditLog({
    userId: actorUserId,
    orgId,
    action: "ORG_INVITE_RESENT",
    entityType: "org_invitation",
    entityId: invitation.id,
    ip,
    userAgent,
    metadata: {
      email: invitation.email,
      role: invitation.role,
      expiresAt,
      emailSent,
    },
  });

  return NextResponse.json({
    invite: {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt,
    },
    inviteLink,
    emailSent,
  });
}
