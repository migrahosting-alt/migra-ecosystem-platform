import { EntitlementStatus, MembershipStatus, OrgRole, ProductKey } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const ENTITLEMENT_ALLOWED_FOR_RUNTIME = new Set<EntitlementStatus>([
  EntitlementStatus.ACTIVE,
  EntitlementStatus.TRIAL,
]);

export function isPrivilegedInternalRole(role: OrgRole): boolean {
  return role === OrgRole.OWNER;
}

interface EntitlementRuntimeInput {
  status: EntitlementStatus | null | undefined;
  startsAt?: Date | null;
  endsAt?: Date | null;
  now?: Date;
  allowInternal?: boolean;
  isInternalOrg?: boolean;
}

export function isEntitlementRuntimeAllowed(
  statusOrInput: EntitlementStatus | null | undefined | EntitlementRuntimeInput,
  role?: OrgRole,
): boolean {
  const normalized: EntitlementRuntimeInput =
    typeof statusOrInput === "object" && statusOrInput !== null && "status" in statusOrInput
      ? statusOrInput
      : { status: statusOrInput };

  const now = normalized.now || new Date();
  const status = normalized.status;

  if (!status) {
    return false;
  }

  if (normalized.startsAt && normalized.startsAt > now) {
    return false;
  }

  if (normalized.endsAt && normalized.endsAt <= now) {
    return false;
  }

  if (status === EntitlementStatus.INTERNAL_ONLY) {
    return Boolean(normalized.allowInternal && normalized.isInternalOrg);
  }

  if (status === EntitlementStatus.RESTRICTED) {
    return false;
  }

  if (role && isPrivilegedInternalRole(role)) {
    return true;
  }

  return ENTITLEMENT_ALLOWED_FOR_RUNTIME.has(status);
}

export async function getOrgEntitlementMap(orgId: string): Promise<Map<ProductKey, EntitlementStatus>> {
  const rows = await prisma.orgEntitlement.findMany({
    where: { orgId },
    select: {
      product: true,
      status: true,
    },
  });

  return new Map(rows.map((row) => [row.product, row.status]));
}

export async function getActiveMembershipByOrg(userId: string, orgId: string) {
  return prisma.membership.findFirst({
    where: {
      userId,
      orgId,
      status: MembershipStatus.ACTIVE,
    },
    include: {
      org: true,
    },
  });
}
