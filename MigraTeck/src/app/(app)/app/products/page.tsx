import { ProductKey } from "@prisma/client";
import { ProductAccessGrid } from "@/components/app/product-access-grid";
import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { getDriveOperationPolicy } from "@/lib/drive/drive-operation-policy";
import { getDriveRecentEvents } from "@/lib/drive/drive-recent-events";
import { getDriveTenantSummary } from "@/lib/drive/drive-tenant-summary";
import { prisma } from "@/lib/prisma";

export default async function ProductsPage() {
  const session = await requireAuthSession();
  const activeMembership = await getActiveOrgContext(session.user.id);

  if (!activeMembership) {
    return <p>No active organization. Create or join one first.</p>;
  }

  const entitlements = await prisma.orgEntitlement.findMany({
    where: { orgId: activeMembership.orgId },
    select: { product: true, status: true, startsAt: true, endsAt: true },
  });
  const driveTenant = await prisma.driveTenant.findUnique({
    where: { orgId: activeMembership.orgId },
    select: { status: true, restrictionReason: true, disableReason: true, storageQuotaGb: true, storageUsedBytes: true },
  });
  const [driveTenantSummary, driveRecentEvents] = await Promise.all([
    getDriveTenantSummary(activeMembership.orgId, driveTenant),
    getDriveRecentEvents(activeMembership.orgId),
  ]);

  const entitlementMap: Partial<
    Record<
      ProductKey,
      {
        status: (typeof entitlements)[number]["status"];
        startsAt: (typeof entitlements)[number]["startsAt"];
        endsAt: (typeof entitlements)[number]["endsAt"];
      }
    >
  > = {};
  for (const entitlement of entitlements) {
    entitlementMap[entitlement.product] = {
      status: entitlement.status,
      startsAt: entitlement.startsAt,
      endsAt: entitlement.endsAt,
    };
  }

  return (
    <section className="space-y-5">
      <h1 className="text-3xl font-black tracking-tight">Products</h1>
      <p className="text-sm text-[var(--ink-muted)]">
        Product availability is enforced by organization entitlement policy and client eligibility controls.
      </p>
      <ProductAccessGrid
        orgId={activeMembership.orgId}
        orgSlug={activeMembership.org.slug}
        isMigraHostingClient={activeMembership.org.isMigraHostingClient}
        entitlements={entitlementMap}
        driveTenant={driveTenant}
        driveTenantSummary={driveTenantSummary}
        driveOperationPolicy={getDriveOperationPolicy()}
        driveRecentEvents={driveRecentEvents}
      />
    </section>
  );
}
