import type { Prisma } from "@prisma/client";
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
  const where: Prisma.DriveTenantWhereInput = {};

  if (filters.status) {
    where.status = filters.status as never;
  }
  if (filters.planCode) {
    where.planCode = filters.planCode;
  }
  if (filters.subscriptionId) {
    where.subscriptionId = filters.subscriptionId;
  }
  if (filters.entitlementId) {
    where.entitlementId = filters.entitlementId;
  }
  if (filters.cursor) {
    where.id = { lt: filters.cursor };
  }

  const items = await prisma.driveTenant.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
  });

  const hasMore = items.length > limit;
  const sliced = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? sliced[sliced.length - 1]?.id : undefined;

  return { items: sliced, nextCursor };
}

export async function listDriveTenantOperations(
  tenantId: string,
  opts: { cursor?: string | null; limit?: number } = {},
) {
  const limit = Math.min(opts.limit ?? 50, 200);
  const where: Prisma.DriveTenantOperationWhereInput = {
    tenantId,
  };

  if (opts.cursor) {
    where.id = { lt: opts.cursor };
  }

  const items = await prisma.driveTenantOperation.findMany({
    where,
    orderBy: { startedAt: "desc" },
    take: limit + 1,
  });

  const hasMore = items.length > limit;
  const sliced = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? sliced[sliced.length - 1]?.id : undefined;

  return { items: sliced, nextCursor };
}
