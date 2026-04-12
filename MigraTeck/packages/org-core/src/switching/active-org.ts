import { MembershipStatus } from "@prisma/client";
import { writeAuditLog } from "@migrateck/audit-core";
import { recordSecurityEvent } from "@migrateck/events";
import { prisma } from "@/lib/prisma";
import { assertMutationSecurity } from "@/lib/security/mutation-guard";
import { MutationIntentError } from "@/lib/security/intent";
import { OperatorRiskError } from "@/lib/security/operator-risk";
import { PlatformLockdownError } from "@/lib/security/platform-lockdown";
import { AuthCoreError } from "@migrateck/auth-core";

export async function switchActiveOrganizationForUser(input: {
  userId: string;
  orgId: string;
  ip: string;
  userAgent: string;
}) {
  const membership = await prisma.membership.findFirst({
    where: {
      userId: input.userId,
      orgId: input.orgId,
      status: MembershipStatus.ACTIVE,
    },
    include: {
      org: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
  });

  if (!membership) {
    throw new AuthCoreError("ORGANIZATION_NOT_FOUND", "Organization not found.", 404);
  }

  try {
    await assertMutationSecurity({
      action: "org:switch",
      actorUserId: input.userId,
      actorRole: membership.role,
      orgId: input.orgId,
      riskTier: 1,
      ip: input.ip,
      userAgent: input.userAgent,
      route: "/api/v1/me/switch-organization",
    });
  } catch (error) {
    if (error instanceof PlatformLockdownError || error instanceof OperatorRiskError || error instanceof MutationIntentError) {
      throw new AuthCoreError("ORG_SWITCH_BLOCKED", "Organization switching is temporarily unavailable.", error.httpStatus);
    }

    throw new AuthCoreError("ORG_SWITCH_BLOCKED", "Organization switching is temporarily unavailable.", 503);
  }

  await prisma.user.update({
    where: { id: input.userId },
    data: { defaultOrgId: input.orgId },
  });

  await writeAuditLog({
    userId: input.userId,
    orgId: input.orgId,
    action: "ORG_SWITCHED",
    entityType: "organization",
    entityId: input.orgId,
    ip: input.ip,
    userAgent: input.userAgent,
  });
  await recordSecurityEvent({
    userId: input.userId,
    orgId: input.orgId,
    eventType: "ORGANIZATION_SWITCHED",
    ip: input.ip,
    userAgent: input.userAgent,
  });

  return membership;
}