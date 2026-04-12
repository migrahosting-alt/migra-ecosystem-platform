import { ProductKey } from "@prisma/client";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ChangePasswordForm } from "@/components/app/change-password-form";
import { PlatformCommandCenter } from "@/components/app/platform-command-center";
import { ProductAccessGrid } from "@/components/app/product-access-grid";
import { LogoutAllSessionsButton } from "@/components/app/logout-all-sessions-button";
import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PRODUCT_CATALOG } from "@/lib/constants";
import { getDriveOperationPolicy } from "@/lib/drive/drive-operation-policy";
import { getDriveRecentEvents } from "@/lib/drive/drive-recent-events";
import { getDriveTenantSummary } from "@/lib/drive/drive-tenant-summary";
import { isVpsPortalHost } from "@/lib/migradrive-auth-branding";
import { prisma } from "@/lib/prisma";
import { resolveProductRuntimeAccess } from "@/lib/products/runtime-access";
import { isInternalOrg } from "@/lib/security/internal-org";
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

  const internalOrg = isInternalOrg(activeMembership.org);
  const launchReadyProducts = PRODUCT_CATALOG.filter((product) => {
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
    }).canLaunch;
  }).length;

  const platformModules = [
    {
      href: "/app/products",
      title: "Product Catalog",
      description: "Entitlement-aware product activation, launch readiness, and request-access handling across the ecosystem.",
      detail: `${launchReadyProducts} launch-ready products in the current org context`,
      tone: launchReadyProducts > 0 ? "success" : "attention",
    },
    {
      href: "/app/orgs",
      title: "Organizations",
      description: "Membership, org context, and account authority stay anchored to one shared tenancy model.",
      detail: `${session.user.organizations.length} visible organization memberships`,
      tone: session.user.organizations.length > 1 ? "success" : "default",
    },
    {
      href: "/app/billing",
      title: "Billing",
      description: "Subscriptions, plan posture, and future commercial controls belong in the same platform contract.",
      detail: can(activeMembership.role, "billing:manage") ? "Billing management available" : "Billing posture is visible through your current role",
      tone: can(activeMembership.role, "billing:manage") ? "success" : "default",
    },
    {
      href: "/app/audit",
      title: "Audit & Security",
      description: "Operator sessions, auth posture, and audit activity are first-class platform capabilities, not side tools.",
      detail: `${auditCount7d} audit events recorded in the last 7 days`,
      tone: auditCount7d > 0 ? "success" : "default",
    },
    {
      href: "/app/launch",
      title: "Launch Workflows",
      description: "Provisioning and activation should be observable platform actions with clear downstream ownership.",
      detail: "Open the launch surface for orchestrated product and service handoff",
      tone: "default",
    },
    {
      href: "/app/downloads",
      title: "Distribution",
      description: "Signed downloads and delivery channels belong under the same trust and identity boundary.",
      detail: "Verified software delivery routed through the platform workspace",
      tone: can(activeMembership.role, "downloads:sign") ? "success" : "default",
    },
    ...(can(activeMembership.role, "ops:read")
      ? [{
          href: "/app/platform/ops",
          title: "Platform Ops",
          description: "Operational control, queue posture, and runtime health should remain attached to the control plane.",
          detail: "Administrative operations surface available for this org role",
          tone: "success" as const,
        }]
      : []),
    ...(activeMembership.role === "OWNER"
      ? [{
          href: "/app/system",
          title: "System",
          description: "Owner-level configuration and emergency authority stay explicit instead of being hidden across runtimes.",
          detail: "System-level ownership controls are available",
          tone: "attention" as const,
        }]
      : []),
  ];

  return (
    <section className="space-y-6">
      <PlatformCommandCenter
        email={session.user.email}
        orgName={activeMembership.org.name}
        orgSlug={activeMembership.org.slug}
        role={activeMembership.role}
        organizationCount={session.user.organizations.length}
        activeSessionCount={activeSessionCount}
        productsActive={launchReadyProducts}
        auditCount7d={auditCount7d}
        lastLoginLabel={lastLogin ? lastLogin.createdAt.toISOString() : "No login event recorded yet"}
        modules={platformModules}
      />

      <div className="grid gap-4 lg:grid-cols-[1.65fr_1fr]">
        <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <h2 className="text-xl font-bold">Product Control</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Activate, launch, and manage product surfaces from the same organization-aware control plane.
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
          <h2 className="text-xl font-bold">Security & Access</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Session posture, operator identity, and audit visibility for the current control-plane context.</p>
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
