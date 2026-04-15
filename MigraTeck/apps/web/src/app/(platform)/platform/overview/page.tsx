import Link from "next/link";
import { requirePermission } from "@migrateck/auth-client";
import { fetchAuthApi } from "@/lib/auth/api";
import { PlatformEmptyState } from "@/components/platform/PlatformEmptyState";
import { PlatformPageHeader } from "@/components/platform/PlatformPageHeader";
import { PlatformStatCard } from "@/components/platform/PlatformStatCard";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { getPlatformOrganizations } from "@/lib/platform";
import { getCommercialSnapshot, getNumericEntitlement, hasProductAccess } from "@/lib/platform/commercial";

export const dynamic = "force-dynamic";

const quickActions = [
  {
    title: "Manage organizations",
    description: "Create a workspace, switch context, and keep billing boundaries clean.",
    href: "/platform/organizations",
  },
  {
    title: "Review members",
    description: "Check access, add teammates, and keep account ownership visible.",
    href: "/platform/members",
  },
  {
    title: "Open billing",
    description: "Review plan status, payment readiness, and commercial next steps.",
    href: "/platform/billing",
  },
  {
    title: "Open Builder",
    description: "Launch your website workspace and start publishing customer-facing pages.",
    href: "/builder/sites",
  },
] as const;

export default async function PlatformOverviewPage() {
  ensureAuthClientInitialized();
  const session = await requirePermission("platform.read");

  const organizations = getPlatformOrganizations(session);
  const activeOrgName = session.activeOrgName ?? "No active organization";
  const activeRole = session.activeOrgRole ?? "No role";
  const ownerName = session.displayName ?? session.email.split("@")[0];
  const hasOrganizations = organizations.length > 0;
  const commercial = await getCommercialSnapshot(session.activeOrgId);

  const [membersResult, sessionsResult, auditResult] = await Promise.all([
    session.activeOrgId
      ? fetchAuthApi<{ members: Array<{ id: string }> }>(`/v1/organizations/${encodeURIComponent(session.activeOrgId)}/members`)
      : Promise.resolve({ ok: false as const, error: "No active organization", status: 400 }),
    fetchAuthApi<{ sessions: Array<{ id: string; current: boolean; last_seen_at: string | null }> }>("/v1/sessions"),
    fetchAuthApi<{ audit_logs: Array<{ id: string; event_type: string; created_at: string; ip_address: string | null }> }>(
      `/v1/admin/audit?user_id=${encodeURIComponent(session.authUserId)}&limit=8&offset=0`,
    ),
  ]);

  const memberCount = membersResult.ok ? membersResult.data.members.length : 0;
  const sessionCount = sessionsResult.ok ? sessionsResult.data.sessions.length : 0;
  const recentActivity = auditResult.ok ? auditResult.data.audit_logs : [];
  const billingReadiness = commercial.account?.status
    ?? (commercial.subscriptions.length > 0 ? "Attached" : hasOrganizations ? "Setup pending" : "Pending");
  const securityPosture = !sessionsResult.ok
    ? "Check Security"
    : sessionCount > 0
      ? `${sessionCount} session${sessionCount === 1 ? "" : "s"}`
      : "Delegated";
  const securityDetail = !sessionsResult.ok
    ? "Open Security to re-check MigraAuth session and MFA posture."
    : sessionCount > 0
      ? `Session expires ${new Date(session.expiresAt).toLocaleString()}. Authentication and MFA are handled by MigraAuth.`
      : "Control-plane access is active, but no direct MigraAuth browser session is currently listed.";
  const activeProducts = [
    {
      title: "Builder",
      href: "/builder/sites",
      enabled: hasProductAccess(commercial.entitlements, "builder"),
      summary: `${getNumericEntitlement(commercial.entitlements, "builder.sites.max") ?? 0} site slots`,
    },
    {
      title: "Hosting",
      href: "/platform/hosting",
      enabled: hasProductAccess(commercial.entitlements, "hosting"),
      summary: `${getNumericEntitlement(commercial.entitlements, "hosting.vps.max") ?? 0} workload slots`,
    },
    {
      title: "Intake",
      href: "/platform/intake",
      enabled: hasProductAccess(commercial.entitlements, "intake"),
      summary: `${getNumericEntitlement(commercial.entitlements, "intake.forms.max") ?? 0} form slots`,
    },
  ];

  const alerts = [
    !hasOrganizations ? "Create an organization to activate the platform control plane." : null,
    commercial.dunningState !== "healthy" && commercial.dunningState !== "none" && commercial.dunningState !== "unknown"
      ? `Billing attention required: ${commercial.dunningState.replace(/_/g, " ")}.`
      : null,
    commercial.subscriptions.length > 0 && commercial.paymentMethods.length === 0
      ? "Add a payment method so commercial operations are not blocked at renewal time."
      : null,
    hasOrganizations && memberCount <= 1
      ? "Only one member has access to the active organization. Add an admin or billing backup."
      : null,
  ].filter((alert): alert is string => Boolean(alert));

  return (
    <div className="p-6 lg:p-8">
      <PlatformPageHeader
        eyebrow="Platform overview"
        title={`Welcome back, ${ownerName}`}
        description="This is the executive control plane for the active organization: operating context, commercial readiness, security posture, governance signals, and product access in one surface."
        actions={
          <>
            <Link
              href="/platform/organizations"
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              Manage organizations
            </Link>
            <Link
              href="/builder/sites"
              className="inline-flex items-center justify-center rounded-full bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              Open Builder
            </Link>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <PlatformStatCard
          label="Organizations"
          value={String(organizations.length)}
          detail={hasOrganizations ? `${activeOrgName} is currently active.` : "Create your first organization to unlock the platform."}
        />
        <PlatformStatCard
          label="Access role"
          value={activeRole}
          detail={`${session.permissions.length} permission${session.permissions.length === 1 ? "" : "s"} are active in this session.`}
        />
        <PlatformStatCard
          label="Billing readiness"
          value={billingReadiness}
          detail={commercial.subscriptions.length > 0 ? `${commercial.subscriptions.length} subscription${commercial.subscriptions.length === 1 ? "" : "s"} connected.` : "Attach a billing profile or subscription to unlock invoices, payment methods, and entitlements."}
        />
        <PlatformStatCard
          label="Security posture"
          value={securityPosture}
          detail={securityDetail}
        />
        <PlatformStatCard
          label="Compliance posture"
          value={recentActivity.length > 0 ? "Tracked" : "Quiet"}
          detail={recentActivity.length > 0 ? `${recentActivity.length} recent audit event${recentActivity.length === 1 ? "" : "s"} visible.` : "No recent audit events are visible for this user."}
        />
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Active products and readiness</h2>
              <p className="mt-1 text-sm text-slate-500">Real org-scoped product access derived from billing entitlements and current commercial state.</p>
            </div>
            <Link href="/platform/billing" className="text-sm font-semibold text-blue-600 hover:text-blue-700">Open billing</Link>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {activeProducts.map((product) => (
              <Link key={product.title} href={product.href} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5 transition hover:border-slate-300 hover:bg-white">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-900">{product.title}</h3>
                  <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${product.enabled ? "border border-emerald-200 bg-emerald-50 text-emerald-700" : "border border-slate-200 bg-white text-slate-500"}`}>
                    {product.enabled ? "Enabled" : "Inactive"}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-500">{product.summary}</p>
              </Link>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Attention items</h2>
          {alerts.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm font-semibold text-emerald-800">No immediate issues surfaced</p>
              <p className="mt-1 text-sm text-emerald-700">Billing, access, and governance do not currently show urgent action items.</p>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {alerts.map((alert) => (
                <div key={alert} className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  {alert}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-5">
            <h2 className="text-sm font-semibold text-slate-900">Quick actions</h2>
            <p className="mt-1 text-sm text-slate-500">Direct paths into the controls an owner is most likely to need next.</p>
          </div>
          <div className="grid gap-4 p-6 md:grid-cols-2">
            {quickActions.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5 transition hover:border-slate-300 hover:bg-white"
              >
                <h3 className="text-sm font-semibold text-slate-900">{action.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">{action.description}</p>
              </Link>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Recent activity</h2>
          {recentActivity.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No recent activity is available for this session.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {recentActivity.map((entry) => (
                <div key={entry.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-900">{entry.event_type.replace(/_/g, " ")}</p>
                    <p className="text-xs text-slate-500">{new Date(entry.created_at).toLocaleString()}</p>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{entry.ip_address ?? "IP unavailable"}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Usage summary</h2>
            <p className="mt-1 text-sm text-slate-500">Current consumption signals visible from the shared billing ledger.</p>
          </div>
          <Link href="/platform/usage" className="text-sm font-semibold text-blue-600 hover:text-blue-700">Open usage</Link>
        </div>
        {commercial.usageSummary.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">No usage has been recorded yet for the active organization.</p>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {commercial.usageSummary.slice(0, 3).map((entry) => (
              <div key={`${entry.productFamily}:${entry.meterName}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{entry.productFamily}</p>
                <p className="mt-2 text-lg font-semibold text-slate-900">{entry.totalQuantity}</p>
                <p className="mt-1 text-sm text-slate-500">{entry.meterName} across {entry.eventCount} event{entry.eventCount === 1 ? "" : "s"}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {!hasOrganizations ? (
        <div className="mt-8">
          <PlatformEmptyState
            title="No organizations yet"
            description="Organizations are the entrypoint for members, billing, and product access. Create one to turn this account into an active platform workspace."
            actionLabel="Create your first organization"
            actionHref="/platform/organizations"
          />
        </div>
      ) : null}
    </div>
  );
}
