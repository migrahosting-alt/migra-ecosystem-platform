import { MembershipStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/api-auth";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { assertMutationSecurity } from "@/lib/security/mutation-guard";
import { OperatorRiskError } from "@/lib/security/operator-risk";
import { PlatformLockdownError } from "@/lib/security/platform-lockdown";
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
    action: "org:invite:accept",
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
    where: {
      tokenHash: hashToken(parsed.data.token),
    },
    include: {
      org: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) {
    await writeAuditLog({
      userId: actorUserId,
      action: "ORG_INVITE_ACCEPT_DENIED",
      entityType: "org_invitation",
      ip,
      userAgent,
      metadata: {
        route: "/api/invites/accept",
        reason: "invalid_or_expired_token",
      },
    });

    return NextResponse.json({ error: "Invitation is invalid or expired." }, { status: 400 });
  }

  if (invitation.email !== actorEmail) {
    await writeAuditLog({
      userId: actorUserId,
      orgId: invitation.orgId,
      action: "AUTHZ_PERMISSION_DENIED",
      entityType: "org_invitation",
      entityId: invitation.id,
      ip,
      userAgent,
      metadata: {
        route: "/api/invites/accept",
        reason: "email_mismatch",
      },
    });

    return NextResponse.json({ error: "Invitation is invalid or expired." }, { status: 400 });
  }

  try {
    await assertMutationSecurity({
      action: "org:invite:accept",
      actorUserId,
      orgId: invitation.orgId,
      riskTier: 1,
      ip,
      userAgent,
      route: "/api/invites/accept",
    });
  } catch (error) {
    if (error instanceof PlatformLockdownError || error instanceof OperatorRiskError) {
      return NextResponse.json({ error: "Provisioning is temporarily unavailable." }, { status: error.httpStatus });
    }

    return NextResponse.json({ error: "Provisioning is temporarily unavailable." }, { status: 503 });
  }

  const acceptedAt = new Date();

  try {
    await prisma.$transaction(async (tx) => {
      const consumed = await tx.orgInvitation.updateMany({
        where: {
          id: invitation.id,
          acceptedAt: null,
        },
        data: {
          acceptedAt,
        },
      });

      if (consumed.count !== 1) {
        throw new Error("INVITE_ALREADY_CONSUMED");
      }

      const existingMembership = await tx.membership.findFirst({
        where: {
          userId: actorUserId,
          orgId: invitation.orgId,
        },
      });

      if (existingMembership) {
        await tx.membership.update({
          where: { id: existingMembership.id },
          data: {
            role: invitation.role,
            status: MembershipStatus.ACTIVE,
          },
        });
      } else {
        await tx.membership.create({
          data: {
            userId: actorUserId,
            orgId: invitation.orgId,
            role: invitation.role,
            status: MembershipStatus.ACTIVE,
          },
        });
      }

      const user = await tx.user.findUnique({
        where: { id: actorUserId },
        select: { defaultOrgId: true },
      });

      if (!user?.defaultOrgId) {
        await tx.user.update({
          where: { id: actorUserId },
          data: {
            defaultOrgId: invitation.orgId,
          },
        });
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "INVITE_ALREADY_CONSUMED") {
      return NextResponse.json({ error: "Invitation is invalid or expired." }, { status: 400 });
    }

    return NextResponse.json({ error: "Unable to accept invitation." }, { status: 500 });
  }

  await writeAuditLog({
    userId: actorUserId,
    orgId: invitation.orgId,
    action: "ORG_INVITE_ACCEPTED",
    entityType: "org_invitation",
    entityId: invitation.id,
    ip,
    userAgent,
    metadata: {
      email: invitation.email,
      role: invitation.role,
      acceptedAt,
    },
  });

  return NextResponse.json({
    org: invitation.org,
    role: invitation.role,
    acceptedAt,
  });
}
