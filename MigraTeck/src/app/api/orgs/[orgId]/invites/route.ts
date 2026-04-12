import { MembershipStatus, OrgRole } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
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

const createInviteSchema = z.object({
  email: z.string().email(),
  role: z.nativeEnum(OrgRole),
});

async function requireInviteManager(request: NextRequest, orgId: string, actorUserId: string) {
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
        route: "/api/orgs/[orgId]/invites",
        reason: "missing_membership",
      },
    });

    return { ok: false as const, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  const allowed = await assertPermission({
    actorUserId,
    orgId,
    role: membership.role,
    action: "org:invite:manage",
    route: "/api/orgs/[orgId]/invites",
    ip,
    userAgent,
  });

  if (!allowed) {
    return { ok: false as const, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { ok: true as const, membership, ip, userAgent };
}

export async function GET(request: NextRequest, context: { params: Promise<{ orgId: string }> }) {
  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { orgId } = await context.params;
  const access = await requireInviteManager(request, orgId, authResult.session.user.id);
  if (!access.ok) {
    return access.response;
  }

  const invites = await prisma.orgInvitation.findMany({
    where: {
      orgId,
      acceptedAt: null,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return NextResponse.json({
    invites: invites.map((invite) => ({
      id: invite.id,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt,
      createdAt: invite.createdAt,
      isExpired: invite.expiresAt < new Date(),
    })),
  });
}

export async function POST(request: NextRequest, context: { params: Promise<{ orgId: string }> }) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return csrfFailure;
  }

  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const actorUserId = authResult.session.user.id;
  const { orgId } = await context.params;

  const access = await requireInviteManager(request, orgId, actorUserId);
  if (!access.ok) {
    return access.response;
  }

  try {
    await assertMutationSecurity({
      action: "org:invite:create",
      actorUserId,
      actorRole: access.membership.role,
      orgId,
      riskTier: 1,
      ip: access.ip,
      userAgent: access.userAgent,
      route: "/api/orgs/[orgId]/invites",
    });
  } catch (error) {
    if (error instanceof PlatformLockdownError || error instanceof OperatorRiskError) {
      return NextResponse.json({ error: "Provisioning is temporarily unavailable." }, { status: error.httpStatus });
    }

    return NextResponse.json({ error: "Provisioning is temporarily unavailable." }, { status: 503 });
  }

  const limiter = await assertRateLimit({
    key: `${actorUserId}:${orgId}:${access.ip}`,
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

  const body = await request.json().catch(() => null);
  const parsed = createInviteSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase();

  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existingUser) {
    const existingMembership = await prisma.membership.findFirst({
      where: {
        userId: existingUser.id,
        orgId,
        status: MembershipStatus.ACTIVE,
      },
      select: { id: true },
    });

    if (existingMembership) {
      return NextResponse.json({ error: "User is already an active member." }, { status: 409 });
    }
  }

  const { token, tokenHash } = generateInvitationToken();
  const inviteLink = buildInvitationLink(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const invitation = await prisma.orgInvitation.create({
    data: {
      orgId,
      email,
      role: parsed.data.role,
      tokenHash,
      expiresAt,
      createdByUserId: actorUserId,
    },
  });

  const emailEnabled = isSmtpConfigured() && isMagicLinkEnabled;
  let emailSent = false;

  if (emailEnabled) {
    emailSent = await sendMail({
      to: email,
      subject: `Invitation to join ${access.membership.org.name} on MigraTeck`,
      text: `You were invited to join ${access.membership.org.name}. Accept: ${inviteLink}`,
      html: `<p>You were invited to join <strong>${access.membership.org.name}</strong>.</p><p><a href="${inviteLink}">Accept invitation</a></p>`,
    });
  }

  await writeAuditLog({
    userId: actorUserId,
    orgId,
    action: "ORG_INVITE_CREATED",
    entityType: "org_invitation",
    entityId: invitation.id,
    ip: access.ip,
    userAgent: access.userAgent,
    metadata: {
      email,
      role: invitation.role,
      expiresAt,
      emailSent,
    },
  });

  return NextResponse.json(
    {
      invite: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
        createdAt: invitation.createdAt,
      },
      inviteLink,
      emailSent,
    },
    { status: 201 },
  );
}
