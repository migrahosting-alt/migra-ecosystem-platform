import Link from "next/link";
import { requirePermission } from "@migrateck/auth-client";
import {
  Activity,
  ArrowRight,
  BadgeDollarSign,
  Building2,
  Code2,
  CreditCard,
  Server,
  ShieldCheck,
  Users,
} from "lucide-react";
import { fetchAuthApi } from "@/lib/auth/api";
import { PlatformPageHeader } from "@/components/platform/PlatformPageHeader";
import { PlatformStatCard } from "@/components/platform/PlatformStatCard";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { getPlatformOrganizations } from "@/lib/platform";
import { getCommercialSnapshot } from "@/lib/platform/commercial";

export const dynamic = "force-dynamic";

type PlatformAccountContext = {
  platformAuthority?: {
    roles?: string[];
    permissions?: string[];
    viaBootstrap?: boolean;
  } | null;
};

const domains = [
  {
    title: "Developers",
    description: "API keys, OAuth applications, webhooks, events, machine access, and API visibility.",
    href: "/platform/developers",
    icon: Code2,
  },
  {
    title: "Commerce",
    description: "MigraPay, catalog, billing, subscriptions, invoices, entitlements, usage, and reconciliation.",
    href: "/platform/commerce",
    icon: BadgeDollarSign,
  },
  {
    title: "Trust",
    description: "Identity assurance, security posture, delegated authority, audit evidence, and compliance.",
    href: "/platform/trust",
    icon: ShieldCheck,
  },
  {
    title: "Organizations",
    description: "Customer and business workspaces, membership boundaries, ownership, and scoped access.",
    href: "/platform/organizations",
    icon: Building2,
  },
  {
    title: "Infrastructure",
    description: "Hosting runtime linkage and Intake service visibility with explicit cross-system ownership boundaries.",
    href: "/platform/hosting",
    icon: Server,
  },
] as const;

export default async function PlatformOverviewPage() {
  ensureAuthClientInitialized();
  const session = await requirePermission("platform.read");

  const organizations = getPlatformOrganizations(session);
  const productAccount = (session.productAccount ?? null) as PlatformAccountContext | null;
  const platformRoles = productAccount?.platformAuthority?.roles ?? [];
  const authorityLabel = platformRoles.length > 0
    ? platformRoles.join(" / ")
    : session.activeOrgRole ?? "Platform access";
  const ownerName = session.displayName ?? session.email.split("@")[0];
  const commercial = await getCommercialSnapshot(session.activeOrgId);

  const [sessionsResult, auditResult] = await Promise.all([
    fetchAuthApi<{ sessions: Array<{ id: string; current: boolean; last_seen_at: string | null }> }>("/v1/sessions"),
    fetchAuthApi<{ audit_logs: Array<{ id: string; event_type: string; created_at: string; ip_address: string | null }> }>(
      "/v1/admin/audit?user_id=" + encodeURIComponent(session.authUserId) + "&limit=6&offset=0",
    ),
  ]);

  const sessionCount = sessionsResult.ok ? sessionsResult.data.sessions.length : 0;
  const recentActivity = auditResult.ok ? auditResult.data.audit_logs : [];
  const orgContext = organizations.find((organization) => organization.id === session.activeOrgId) ?? organizations[0] ?? null;

  return (
    <div className="p-6 lg:p-8">
      <PlatformPageHeader
        eyebrow="Parent platform"
        title={"Welcome back, " + ownerName}
        description="Operate MigraTeck's shared company primitives: identity, developer access, commerce, metering, organizations, infrastructure bridges, security, and governance. Product execution stays in the products; operator execution stays in MigraPanel."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/platform/developers"
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              Developer platform <ArrowRight size={14} />
            </Link>
            <Link
              href="/platform/commerce"
              className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              Open commerce <ArrowRight size={14} />
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <PlatformStatCard
          label="Platform authority"
          value={authorityLabel}
          detail={platformRoles.length > 0 ? "Canonical MigraAuth platform authority." : "Access resolved from the active organization context."}
        />
        <PlatformStatCard
          label="Organizations"
          value={String(organizations.length)}
          detail={orgContext ? orgContext.name + " is available as an organization scope." : "No organization scope is required for parent-platform authority."}
        />
        <PlatformStatCard
          label="Permissions"
          value={String(session.permissions.length)}
          detail="Effective permissions active in this parent-platform session."
        />
        <PlatformStatCard
          label="Security sessions"
          value={sessionsResult.ok ? String(sessionCount) : "Check"}
          detail={sessionsResult.ok ? "MigraAuth browser/device sessions currently visible." : "Open Trust to review the current identity session."}
        />
      </div>

      <section className="mt-7 rounded-3xl border border-slate-200 bg-[radial-gradient(circle_at_15%_15%,rgba(59,130,246,.08),transparent_34%),linear-gradient(135deg,#ffffff,#f8fafc)] p-6 shadow-sm">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">Platform domains</p>
          <h2 className="text-xl font-semibold tracking-tight text-slate-950">Shared infrastructure, separated by responsibility.</h2>
          <p className="max-w-4xl text-sm leading-6 text-slate-600">
            These are the parent-company primitives every product can consume. They are intentionally separated from child-product workflow and MigraPanel operator actions.
          </p>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {domains.map((domain) => {
            const Icon = domain.icon;
            return (
              <Link
                key={domain.href}
                href={domain.href}
                className="group rounded-2xl border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
              >
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-600 transition group-hover:bg-blue-600 group-hover:text-white">
                  <Icon size={19} />
                </span>
                <h3 className="mt-4 text-base font-semibold text-slate-950">{domain.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{domain.description}</p>
                <span className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-blue-600">
                  Open domain <ArrowRight size={14} />
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <div className="mt-7 grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Scoped business context</p>
            <h2 className="mt-1 text-base font-semibold text-slate-950">
              {orgContext ? orgContext.name : "No organization selected"}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {orgContext
                ? "Organization-scoped commercial and member state is available below."
                : "Parent-platform access remains fully valid. Create or join an organization only when you need customer/commercial scope."}
            </p>
          </div>

          {orgContext ? (
            <div className="grid gap-4 p-6 md:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <Users size={18} className="text-violet-600" />
                <p className="mt-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">Role</p>
                <p className="mt-1 text-base font-semibold text-slate-950">{session.activeOrgRole ?? "Member"}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <CreditCard size={18} className="text-violet-600" />
                <p className="mt-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">Billing</p>
                <p className="mt-1 text-base font-semibold text-slate-950">{commercial.account?.status ?? "Not configured"}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <Activity size={18} className="text-violet-600" />
                <p className="mt-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">Usage meters</p>
                <p className="mt-1 text-base font-semibold text-slate-950">{commercial.usageSummary.length}</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-950">Organization scope is optional here.</p>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
                  Organizations become necessary for customer membership, billing ownership, entitlements, and organization-scoped API credentials.
                </p>
              </div>
              <Link
                href="/platform/organizations"
                className="inline-flex shrink-0 items-center justify-center rounded-full border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Manage organizations
              </Link>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Governance evidence</p>
              <h2 className="mt-1 text-base font-semibold text-slate-950">Recent identity activity</h2>
            </div>
            <Link href="/platform/compliance" className="text-sm font-semibold text-blue-600">Open audit</Link>
          </div>

          {recentActivity.length === 0 ? (
            <p className="mt-5 text-sm text-slate-500">No recent audit activity is visible for this identity.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {recentActivity.map((entry) => (
                <div key={entry.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
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
    </div>
  );
}
