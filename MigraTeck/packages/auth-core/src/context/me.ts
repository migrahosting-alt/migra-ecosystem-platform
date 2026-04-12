import { MembershipStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { IdentityContextView } from "@migrateck/api-contracts";
import { AuthCoreError } from "../errors";
import { buildIdentityContext } from "./views";

export async function getCurrentIdentityContext(input: {
  userId: string;
  preferredOrgId?: string | null | undefined;
  accessToken?: string | undefined;
}): Promise<IdentityContextView> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: {
      id: true,
      email: true,
      name: true,
      emailVerified: true,
      createdAt: true,
      updatedAt: true,
      accountLockedUntil: true,
      defaultOrgId: true,
    },
  });

  if (!user) {
    throw new AuthCoreError("UNAUTHORIZED", "Unauthorized.", 401);
  }

  const memberships = await prisma.membership.findMany({
    where: {
      userId: input.userId,
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
    orderBy: { createdAt: "asc" },
  });

  const preferredOrgId = input.preferredOrgId ?? user.defaultOrgId ?? null;
  const activeMembership = memberships.find((membership) => membership.orgId === preferredOrgId)
    ?? memberships[0]
    ?? null;

  return buildIdentityContext({
    user,
    memberships,
    activeMembership,
    ...(input.accessToken ? { accessToken: input.accessToken } : {}),
  });
}