import { ProductKey } from "@prisma/client";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ChangePasswordForm } from "@/components/app/change-password-form";
import { ProductAccessGrid } from "@/components/app/product-access-grid";
import { LogoutAllSessionsButton } from "@/components/app/logout-all-sessions-button";
import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { getDriveOperationPolicy } from "@/lib/drive/drive-operation-policy";
import { getDriveRecentEvents } from "@/lib/drive/drive-recent-events";
import { getDriveTenantSummary } from "@/lib/drive/drive-tenant-summary";
import { isVpsPortalHost } from "@/lib/migradrive-auth-branding";
import { prisma } from "@/lib/prisma";
import { listVpsServersForOrg, orgPrefersVpsWorkspace } from "@/lib/vps/data";
import { listSuggestions, getActiveSuggestionCount } from "@/lib/suggestions";
import { getJourney } from "@/lib/customer-journey";
import { SuggestionWidget } from "@/components/app/suggestion-widget";
import { JourneyWidget } from "@/components/app/journey-widget";

export default async function DashboardPage() {
  const session = await requireAuthSession();
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  const activeMembership = await getActiveOrgContext(session.user.id);
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  if (isVpsPortalHost(host)) {
    redirect("/app/vps");
  }

  if (!activeMembership) {
    return (
      <section className="space-y-5">
        <h1 className="text-3xl font-black tracking-tight">Dashboard</h1>
        <p className="rounded-2xl border border-[var(--line)] bg-white p-4 text-sm text-[var(--ink-muted)]">
          No organization context is available yet. Create or join an organization to activate product controls.
        </p>
      </section>
    );
  }

  if (await orgPrefersVpsWorkspace(activeMembership)) {
    const servers = await listVpsServersForOrg(activeMembership.orgId);
    const firstServer = servers[0];
    if (servers.length === 1 && firstServer) {
      redirect(`/app/vps/${firstServer.id}`);
    }

    redirect("/app/vps");
  }

  const [entitlements, driveTenant, activeSessionCount, lastLogin, auditCount7d] = await Promise.all([
    prisma.orgEntitlement.findMany({
      where: { orgId: activeMembership.orgId },
      select: { product: true, status: true, startsAt: true, endsAt: true },
    }),
    prisma.driveTenant.findUnique({
      where: { orgId: activeMembership.orgId },
      select: { status: true, restrictionReason: true, disableReason: true, storageQuotaGb: true, storageUsedBytes: true },
    }),
    prisma.session.count({
      where: {
        userId: session.user.id,
        expires: { gt: new Date() },
      },
    }),
    prisma.auditLog.findFirst({
      where: {
        userId: session.user.id,
        action: "AUTH_LOGIN_SUCCESS",
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.auditLog.count({
      where: {
        orgId: activeMembership.orgId,
        createdAt: { gte: sevenDaysAgo },
      },
    }),
  ]);
  const [driveTenantSummary, driveRecentEvents, suggestions, suggestionCount, journey] = await Promise.all([
    getDriveTenantSummary(activeMembership.orgId, driveTenant),
    getDriveRecentEvents(activeMembership.orgId),
    listSuggestions(activeMembership.orgId, { status: "ACTIVE", limit: 5 }),
    getActiveSuggestionCount(activeMembership.orgId),
    getJourney(activeMembership.orgId),
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
    <section className="space-y-6">
      <article className="rounded-2xl border border-[var(--line)] bg-white p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Ecosystem command center</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">MigraTeck Platform Dashboard</h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--ink-muted)]">
          Central authority for tenant identity, product launch controls, and operational security across the full Migra stack.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Signed in as</p>
            <p className="mt-1 text-sm font-semibold text-[var(--ink)]">{session.user.email}</p>
          </div>
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Active organization</p>
            <p className="mt-1 text-sm font-semibold text-[var(--ink)]">{activeMembership.org.name}</p>
          </div>
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Role context</p>
            <p className="mt-1 text-sm font-semibold text-[var(--ink)]">{activeMembership.role}</p>
          </div>
        </div>
      </article>

      <div className="grid gap-4 lg:grid-cols-[1.65fr_1fr]">
        <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <h2 className="text-xl font-bold">Product Access</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Entitlement-aware launch control for every ecosystem product.
          </p>
          <div className="mt-4">
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
          </div>
        </article>

        <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <h2 className="text-xl font-bold">Security Overview</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Session and audit posture for the current operator context.</p>
          <div className="mt-4 space-y-3">
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Active sessions</p>
              <p className="mt-1 text-xl font-bold">{activeSessionCount}</p>
            </div>
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Last login</p>
              <p className="mt-1 text-sm font-semibold text-[var(--ink)]">
                {lastLogin ? lastLogin.createdAt.toISOString() : "No login event recorded"}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Audit events (7d)</p>
              <p className="mt-1 text-xl font-bold">{auditCount7d}</p>
            </div>
          </div>
          <div className="mt-4">
            <LogoutAllSessionsButton />
          </div>
        </article>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SuggestionWidget suggestions={suggestions} activeCount={suggestionCount} />
        <JourneyWidget journey={journey} productsActive={entitlements.filter((e) => e.status === "ACTIVE").length} />
      </div>

      <ChangePasswordForm email={session.user.email} />
    </section>
  );
}
