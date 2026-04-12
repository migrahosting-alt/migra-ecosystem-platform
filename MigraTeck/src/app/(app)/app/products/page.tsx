import { ProductKey } from "@prisma/client";
import Link from "next/link";
import { ProductAccessGrid } from "@/components/app/product-access-grid";
import { PRODUCT_CATALOG } from "@/lib/constants";
import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { getDriveOperationPolicy } from "@/lib/drive/drive-operation-policy";
import { getDriveRecentEvents } from "@/lib/drive/drive-recent-events";
import { getDriveTenantSummary } from "@/lib/drive/drive-tenant-summary";
import { prisma } from "@/lib/prisma";
import { resolveProductRuntimeAccess } from "@/lib/products/runtime-access";
import { isInternalOrg } from "@/lib/security/internal-org";

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

  const internalOrg = isInternalOrg(activeMembership.org);
  const productRuntimeSummary = PRODUCT_CATALOG.map((product) => {
    const entitlement = entitlementMap[product.key];
    const driveTenantInput = driveTenant
      ? {
          status: driveTenant.status,
          ...(driveTenant.restrictionReason !== null ? { restrictionReason: driveTenant.restrictionReason } : {}),
          ...(driveTenant.disableReason !== null ? { disableReason: driveTenant.disableReason } : {}),
        }
      : null;

    return resolveProductRuntimeAccess({
      productKey: product.key,
      entitlement,
      isMigraHostingClient: activeMembership.org.isMigraHostingClient,
      isInternalOrg: internalOrg,
      driveTenant: driveTenantInput,
    });
  });

  const launchReadyCount = productRuntimeSummary.filter((runtime) => runtime.canLaunch).length;
  const requestAccessCount = productRuntimeSummary.filter((runtime) => runtime.requestAccess).length;
  const restrictedCount = productRuntimeSummary.filter((runtime) => !runtime.canLaunch).length;

  return (
    <section className="space-y-5">
      <article className="rounded-[2rem] border border-[var(--line)] bg-white p-6 shadow-sm sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-muted)]">Platform catalog</p>
        <div className="mt-3 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-black tracking-tight">Products operate through one entitlement-aware catalog.</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--ink-muted)]">
              This is the platform-facing product registry for {activeMembership.org.name}. Every launch, restriction, and request-access state should be visible here through one organization context.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/app" className="inline-flex items-center justify-center rounded-full border border-[var(--line)] bg-white/92 px-5 py-2.5 text-sm font-semibold text-[var(--ink)] shadow-[0_8px_20px_rgba(10,22,40,0.06)] transition hover:-translate-y-0.5 hover:bg-[var(--surface-3)]">
              Control plane
            </Link>
            <Link href="/app/launch" className="inline-flex items-center justify-center rounded-full bg-[linear-gradient(180deg,#0f7ad8,#0a4f99)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(15,122,216,0.30)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_36px_rgba(15,122,216,0.38)]">
              Launch workflows
            </Link>
          </div>
        </div>
        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Launch-ready</p>
            <p className="mt-1 text-2xl font-bold text-[var(--ink)]">{launchReadyCount}</p>
          </div>
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Request access</p>
            <p className="mt-1 text-2xl font-bold text-[var(--ink)]">{requestAccessCount}</p>
          </div>
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Restricted</p>
            <p className="mt-1 text-2xl font-bold text-[var(--ink)]">{restrictedCount}</p>
          </div>
        </div>
      </article>
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
