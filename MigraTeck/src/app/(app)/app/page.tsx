import { ProductKey } from "@prisma/client";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MigraHostingEmptyState } from "@/components/dashboard/migrahosting-empty-state";
import { MigraHostingPageHeader } from "@/components/dashboard/migrahosting-page-header";
import { MigraHostingPanel } from "@/components/dashboard/migrahosting-panel";
import { MigraHostingQuickAction } from "@/components/dashboard/migrahosting-quick-action";
import { MigraHostingStatCard } from "@/components/dashboard/migrahosting-stat-card";
import { PRODUCT_CATALOG } from "@/lib/constants";
import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { isVpsPortalHost } from "@/lib/migradrive-auth-branding";
import { prisma } from "@/lib/prisma";
import { resolveProductRuntimeAccess } from "@/lib/products/runtime-access";
import { isInternalOrg } from "@/lib/security/internal-org";
import { listVpsServersForOrg, orgPrefersVpsWorkspace } from "@/lib/vps/data";

function formatTimestamp(value: Date | null | undefined) {
  if (!value) {
    return "No recent sign-in";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function resolveWorkspaceHref(productKey: ProductKey) {
  switch (productKey) {
    case ProductKey.MIGRAHOSTING:
      return "/app/vps";
    case ProductKey.MIGRADRIVE:
      return "/app/drive";
    case ProductKey.MIGRAINVOICE:
      return "/app/billing";
    case ProductKey.MIGRAMARKET:
      return "/app/migramarket";
    case ProductKey.MIGRATECK:
      return "/app/orgs";
    default:
      return "/app/products";
  }
}

export default async function DashboardPage() {
  const session = await requireAuthSession();
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  const migraAuthBaseUrl = process.env.MIGRAAUTH_BASE_URL || "https://auth.migrateck.com";
  const activeMembership = await getActiveOrgContext(session.user.id);

  if (isVpsPortalHost(host)) {
    redirect("/app/vps");
  }

  if (!activeMembership) {
    return (
      <MigraHostingEmptyState
        title="No workspace is active yet"
        description="Create or join an organization to unlock hosting services, billing, and shared account access."
        ctaLabel="Open organizations"
        ctaHref="/app/orgs"
      />
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

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [entitlements, activeSessionCount, lastLogin, auditCount7d] = await Promise.all([
    prisma.orgEntitlement.findMany({
      where: { orgId: activeMembership.orgId },
      select: { product: true, status: true, startsAt: true, endsAt: true },
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
        action: "AUTH_LOGIN_COMPLETED",
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
  const runtimeProducts = PRODUCT_CATALOG.map((product) => {
    const entitlement = entitlementMap[product.key];
    const runtime = resolveProductRuntimeAccess({
      productKey: product.key,
      entitlement,
      isMigraHostingClient: activeMembership.org.isMigraHostingClient,
      isInternalOrg: internalOrg,
      driveTenant: null,
    });

    return { product, entitlement, runtime };
  });

  const activeProducts = runtimeProducts.filter((entry) => entry.runtime.canLaunch);
  const supportEmail = activeMembership.org.isMigraHostingClient ? "support@migrahosting.com" : "support@migrateck.com";
  const hasBillingAccess = can(activeMembership.role, "billing:manage");
  const welcomeName = session.user.name?.trim() || activeMembership.org.name;
  const visibleServiceEntries = runtimeProducts.filter((entry) => entry.runtime.canLaunch || Boolean(entry.entitlement));

  return (
    <div className="space-y-6">
      <MigraHostingPageHeader
        eyebrow="Overview"
        title={`Welcome back, ${welcomeName}`}
        description="Manage servers, services, billing, and account operations from your MigraHosting workspace."
        actions={(
          <>
            <Link
              href="/app/billing"
              className="inline-flex h-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] px-4 text-sm font-medium text-white/80 transition hover:bg-white/[0.06] hover:text-white"
            >
              View billing
            </Link>
            <Link
              href={activeProducts.some((entry) => entry.product.key === ProductKey.MIGRAHOSTING) ? "/app/vps" : "/app/products"}
              className="inline-flex h-11 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#7c3aed_0%,#ec4899_100%)] px-4 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(168,85,247,0.25)] transition hover:opacity-95"
            >
              {activeProducts.some((entry) => entry.product.key === ProductKey.MIGRAHOSTING) ? "Open VPS" : "Browse services"}
            </Link>
          </>
        )}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MigraHostingStatCard
          label="Active Services"
          value={String(activeProducts.length)}
          meta={`${visibleServiceEntries.length} visible in this workspace`}
        />
        <MigraHostingStatCard
          label="Active Sessions"
          value={String(activeSessionCount)}
          meta="Across your MigraTeck account"
        />
        <MigraHostingStatCard
          label="Workspace Role"
          value={String(activeMembership.role)}
          meta={activeMembership.org.name}
        />
        <MigraHostingStatCard
          label="Audit Events"
          value={String(auditCount7d)}
          meta="Recorded in the last 7 days"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <MigraHostingPanel
          title="Workspace overview"
          description="Track your service posture, billing access, and account context from one operational surface."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/40">
                Organization
              </p>
              <p className="mt-3 text-sm text-white/80">{activeMembership.org.name}</p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/40">
                Last sign-in
              </p>
              <p className="mt-3 text-sm text-white/80">{formatTimestamp(lastLogin?.createdAt)}</p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/40">
                Billing access
              </p>
              <p className="mt-3 text-sm text-white/80">
                {hasBillingAccess ? "Billing management available" : "Billing visibility is limited by your role"}
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/40">
                Security
              </p>
              <p className="mt-3 text-sm text-white/80">
                Review sessions and account controls in MigraAuth.
              </p>
            </div>
          </div>
        </MigraHostingPanel>

        <MigraHostingPanel
          title="Quick actions"
          description="Common tasks for day-to-day hosting and account operations."
        >
          <div className="space-y-3">
            <MigraHostingQuickAction
              title="Open services"
              description="Review what this organization can launch and access right now."
              href="/app/products"
            />
            <MigraHostingQuickAction
              title="Review billing"
              description="Check subscriptions, invoices, and the current billing posture."
              href="/app/billing"
            />
            <MigraHostingQuickAction
              title="Account security"
              description="Inspect active sessions and account controls in MigraAuth."
              href={`${migraAuthBaseUrl}/sessions`}
            />
          </div>
        </MigraHostingPanel>
      </div>

      <MigraHostingPanel
        title="Available services"
        description="Only the products relevant to this organization are shown here, so the workspace stays focused on what you actually use."
      >
        {visibleServiceEntries.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleServiceEntries.map(({ product, runtime }) => (
              <Link
                key={product.key}
                href={resolveWorkspaceHref(product.key)}
                className="rounded-[24px] border border-white/10 bg-white/[0.03] p-5 transition hover:bg-white/[0.05]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/40">
                      {product.code}
                    </p>
                    <h3 className="mt-2 text-base font-semibold tracking-[-0.02em] text-white">
                      {product.name}
                    </h3>
                  </div>
                  <span
                    className={[
                      "rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]",
                      runtime.canLaunch
                        ? "border-emerald-400/20 bg-emerald-500/15 text-emerald-200"
                        : "border-amber-400/20 bg-amber-500/15 text-amber-200",
                    ].join(" ")}
                  >
                    {runtime.canLaunch ? "Ready" : "Review"}
                  </span>
                </div>

                <p className="mt-3 text-sm leading-6 text-white/55">
                  {product.description}
                </p>

                <p className="mt-4 text-sm font-semibold text-fuchsia-200">
                  {runtime.canLaunch ? "Open workspace" : "Review access"} →
                </p>
              </Link>
            ))}
          </div>
        ) : (
          <MigraHostingEmptyState
            title="No services are active yet"
            description="This organization does not have any launch-ready services right now. Review product access or contact support to continue."
            ctaLabel="Open services"
            ctaHref="/app/products"
          />
        )}
      </MigraHostingPanel>

      <MigraHostingPanel
        title="Support and account"
        description="Reach the right next step quickly when you need help or need to adjust account access."
      >
        <div className="grid gap-3 md:grid-cols-3">
          <MigraHostingQuickAction
            title="Organization settings"
            description="Review memberships, active organization context, and workspace details."
            href="/app/orgs"
          />
          <MigraHostingQuickAction
            title="Contact support"
            description={`Reach ${supportEmail} for billing, services, or access help.`}
            href={`mailto:${supportEmail}`}
          />
          <MigraHostingQuickAction
            title="Manage sessions"
            description="Open your centralized MigraAuth sessions and security settings."
            href={`${migraAuthBaseUrl}/sessions`}
          />
        </div>
      </MigraHostingPanel>
    </div>
  );
}
