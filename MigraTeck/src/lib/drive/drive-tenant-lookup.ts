import { prisma } from "@/lib/prisma";

export interface DriveTenantListFilters {
  status?: string | null | undefined;
  planCode?: string | null | undefined;
  subscriptionId?: string | null | undefined;
  entitlementId?: string | null | undefined;
  cursor?: string | null | undefined;
  limit?: number | undefined;
}

export async function getDriveTenantById(tenantId: string) {
  return prisma.driveTenant.findUnique({ where: { id: tenantId } });
}

export async function getDriveTenantByOrgId(orgId: string) {
  return prisma.driveTenant.findUnique({ where: { orgId } });
}

export async function getDriveTenantByOrgSlug(orgSlug: string) {
  return prisma.driveTenant.findUnique({ where: { orgSlug } });
}

export async function getDriveTenantBySubscriptionId(subscriptionId: string) {
  return prisma.driveTenant.findFirst({ where: { subscriptionId } });
}

export async function getDriveTenantByEntitlementId(entitlementId: string) {
  return prisma.driveTenant.findFirst({ where: { entitlementId } });
}

export async function listDriveTenants(filters: DriveTenantListFilters = {}) {
  const limit = Math.min(filters.limit ?? 50, 200);

  const items = await prisma.driveTenant.findMany({
    where: {
      status: filters.status ? (filters.status as never) : undefined,
      planCode: filters.planCode || undefined,
      subscriptionId: filters.subscriptionId || undefined,
      entitlementId: filters.entitlementId || undefined,
      id: filters.cursor ? { lt: filters.cursor } : undefined,
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
  });

  const hasMore = items.length > limit;
  const sliced = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? sliced[sliced.length - 1].id : undefined;

  return { items: sliced, nextCursor };
}

export async function listDriveTenantOperations(
  tenantId: string,
  opts: { cursor?: string | null; limit?: number } = {},
) {
  const limit = Math.min(opts.limit ?? 50, 200);

  const items = await prisma.driveTenantOperation.findMany({
    where: {
      tenantId,
      id: opts.cursor ? { lt: opts.cursor } : undefined,
    },
    orderBy: { startedAt: "desc" },
    take: limit + 1,
  });

  const hasMore = items.length > limit;
  const sliced = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? sliced[sliced.length - 1].id : undefined;

  return { items: sliced, nextCursor };
}
