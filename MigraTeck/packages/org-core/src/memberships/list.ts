import { MembershipStatus } from "@prisma/client";
import type { IdentityMembershipView } from "@migrateck/api-contracts";
import { prisma } from "@/lib/prisma";
import { toIdentityMembershipView } from "@migrateck/auth-core";

export async function listActiveOrganizationsForUser(
  userId: string,
  currentOrgId?: string | null | undefined,
): Promise<IdentityMembershipView[]> {
  const memberships = await prisma.membership.findMany({
    where: {
      userId,
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

  return memberships.map((membership) =>
    toIdentityMembershipView(membership, currentOrgId),
  );
}