import { MembershipStatus } from "@prisma/client";
import { ACTIVE_ORG_COOKIE } from "@/lib/constants";
import { prisma } from "@/lib/prisma";

export function slugifyOrganizationName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export async function getActiveMembership(userId: string, orgId?: string | null) {
  if (orgId) {
    const membership = await prisma.membership.findFirst({
      where: {
        userId,
        orgId,
        status: MembershipStatus.ACTIVE,
      },
      include: { org: true },
    });

    if (membership) {
      return membership;
    }
  }

  return prisma.membership.findFirst({
    where: {
      userId,
      status: MembershipStatus.ACTIVE,
    },
    include: { org: true },
    orderBy: { createdAt: "asc" },
  });
}

export { ACTIVE_ORG_COOKIE };
