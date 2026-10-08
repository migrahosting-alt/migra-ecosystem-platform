import Link from "next/link";
import { requirePermission } from "@migrateck/auth-client";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BadgeDollarSign,
  BellRing,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Code2,
  CreditCard,
  Gauge,
  KeyRound,
  Layers3,
  LockKeyhole,
  ReceiptText,
  RefreshCw,
  Server,
  ShieldCheck,
  Users,
  Webhook,
} from "lucide-react";
import {
  fetchAuthApi,
  fetchPlatformApi,
  fetchPlatformAuthorityApi,
} from "@/lib/auth/api";
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

type IdentityDiagnostic = {
  authenticated: true;
  strategy: "migraauth-oauth2-bearer";
  user: {
    id: string;
    email: string | null;
    displayName: string | null;
    status: string;
  };
  selectedOrganization: {
    id: string;
    name: string;
    slug: string;
    role: string;
  } | null;
  platformOperator: {
    authorized: boolean;
    roles: string[];
    permissions: string[];
    viaBootstrap: boolean;
  };
  bridge: {
    user: {
      status: "linked" | "email_candidate" | "missing";
      platformUserId: string | null;
    };
    organization: {
      status: "linked" | "slug_candidate" | "missing" | "not_selected";
      platformOrganizationId: string | null;
      authOrganizationId: string | null;
    };
  };
};

type SessionRecord = {
  id: string;
  current: boolean;
  last_seen_at: string | null;
};

type AuditRecord = {
  id: string;
  event_type: string;
  created_at: string;
  ip_address: string | null;
};

type ApiKeyRecord = {
  id: string;
  status: "ACTIVE" | "REVOKED" | "EXPIRED";
  expiresAt: string | null;
  lastUsedAt: string | null;
};

type WebhookEndpoint = {
  id: string;
  status: "ACTIVE" | "PAUSED" | "DISABLED";
  failCount: number;
  lastDeliveryAt: string | null;
};

type IntakeRuntimeOverview = {
  runtime: {
    tenantScoped: false;
    health: {
      reachable: boolean;
      status: string;
    };
  };
  legacy: {
    counts: {
      projects: number;
      submissions: number;
    };
  };
};

type HealthState = "operational" | "attention" | "degraded" | "unavailable" | "context";

type ApiReadResult<T> =
  | { data: T; ok: true }
  | { error: string; status: number; ok: false };

async function failClosedRead<T>(promise: Promise<ApiReadResult<T>>): Promise<ApiReadResult<T>> {
  try {
    return await promise;
  } catch {
    return { error: "Source unavailable", status: 503, ok: false };
  }
}

const domains = [
  {
    key: "developers",
    title: "Developers",
    description: "API keys, OAuth applications, webhooks, events, machine access, and API visibility.",
    href: "/platform/developers",
    icon: Code2,
  },
  {
    key: "commerce",
    title: "Commerce",
    description: "MigraPay, catalog, billing, subscriptions, invoices, entitlements, usage, and reconciliation.",
    href: "/platform/commerce",
    icon: BadgeDollarSign,
  },
  {
    key: "trust",
    title: "Trust",
    description: "Identity assurance, security posture, delegated authority, audit evidence, and compliance.",
    href: "/platform/trust",
    icon: ShieldCheck,
  },
  {
    key: "organizations",
    title: "Organizations",
    description: "Customer and business workspaces, membership boundaries, ownership, and scoped access.",
    href: "/platform/organizations",
    icon: Building2,
  },
  {
    key: "infrastructure",
    title: "Infrastructure",
    description: "Hosting runtime linkage and Intake service visibility with explicit cross-system ownership boundaries.",
    href: "/platform/hosting",
    icon: Server,
  },
] as const;

const productRoutes: Record<string, string> = {
  builder: "/builder/sites",
  hosting: "/platform/hosting",
  intake: "/platform/intake",
};

function titleCase(value: string) {
  return value
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }) + " UTC";
}

function healthLabel(state: HealthState) {
  if (state === "operational") return "Operational";
  if (state === "attention") return "Needs attention";
  if (state === "degraded") return "Reduced visibility";
  if (state === "context") return "Context required";
  return "Unavailable";
}

function healthClasses(state: HealthState) {
  if (state === "operational") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (state === "attention") return "border-amber-200 bg-amber-50 text-amber-800";
  if (state === "degraded") return "border-orange-200 bg-orange-50 text-orange-700";
  if (state === "context") return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

function statusDotClasses(state: HealthState) {
  if (state === "operational") return "bg-emerald-500";
  if (state === "attention") return "bg-amber-500";
  if (state === "degraded") return "bg-orange-500";
  if (state === "context") return "bg-blue-500";
  return "bg-rose-500";
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Activity;
  tone?: "default" | "good" | "warn" | "danger";
}) {
  const iconClass = tone === "good"
    ? "bg-emerald-50 text-emerald-600"
    : tone === "warn"
      ? "bg-amber-50 text-amber-600"
      : tone === "danger"
        ? "bg-rose-50 text-rose-600"
        : "bg-blue-50 text-blue-600";

  return (
    <article className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
          <p className="mt-2 truncate text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">{value}</p>
        </div>
        <span className={"grid h-9 w-9 shrink-0 place-items-center rounded-xl " + iconClass}>
          <Icon size={17} />
        </span>
      </div>
      <p className="mt-2 text-[13px] leading-5 text-slate-600 sm:text-sm">{detail}</p>
    </article>
  );
}

export default async function PlatformOverviewPage() {
  ensureAuthClientInitialized();
  const session = await requirePermission("platform.read");

  const organizations = getPlatformOrganizations(session);
  const productAccount = (session.productAccount ?? null) as PlatformAccountContext | null;
  const platformRoles = productAccount?.platformAuthority?.roles ?? [];
  const hasPlatformAuthority = platformRoles.length > 0;
  const authorityLabel = hasPlatformAuthority
    ? platformRoles.join(" / ")
    : session.activeOrgRole ?? "Platform access";
  const ownerName = session.displayName ?? session.email.split("@")[0];
  const orgContext = organizations.find((organization) => organization.id === session.activeOrgId)
    ?? organizations[0]
    ?? null;
  const orgId = orgContext?.id ?? session.activeOrgId ?? null;

  const commercialPromise = getCommercialSnapshot(orgId);

  const [
    identityResult,
    sessionsResult,
    auditResult,
    membersResult,
    apiKeysResult,
    webhooksResult,
    hostingResult,
    intakeResult,
    commercial,
  ] = await Promise.all([
    failClosedRead(fetchPlatformAuthorityApi<IdentityDiagnostic>(
      "/auth/session" + (orgId ? "?organizationId=" + encodeURIComponent(orgId) : ""),
      { signal: AbortSignal.timeout(5000) },
    )),
    failClosedRead(fetchAuthApi<{ sessions: SessionRecord[] }>("/v1/sessions", { signal: AbortSignal.timeout(5000) })),
    failClosedRead(fetchAuthApi<{ audit_logs: AuditRecord[] }>(
      "/v1/admin/audit?user_id=" + encodeURIComponent(session.authUserId) + "&limit=10&offset=0",
      { signal: AbortSignal.timeout(5000) },
    )),
    orgId
      ? failClosedRead(fetchAuthApi<{ members: Array<{ id: string }> }>("/v1/organizations/" + encodeURIComponent(orgId) + "/members", { signal: AbortSignal.timeout(5000) }))
      : Promise.resolve({ ok: false as const, error: "No organization context", status: 409 }),
    orgId
      ? failClosedRead(fetchPlatformApi<{ keys: ApiKeyRecord[] }>("/developer/api-keys", orgId, { signal: AbortSignal.timeout(5000) }))
      : Promise.resolve({ ok: false as const, error: "No organization context", status: 409 }),
    orgId
      ? failClosedRead(fetchPlatformApi<{ endpoints: WebhookEndpoint[] }>("/developer/webhooks", orgId, { signal: AbortSignal.timeout(5000) }))
      : Promise.resolve({ ok: false as const, error: "No organization context", status: 409 }),
    orgId
      ? failClosedRead(fetchPlatformApi<Record<string, unknown>>("/hosting", orgId, { signal: AbortSignal.timeout(5000) }))
      : Promise.resolve({ ok: false as const, error: "No organization context", status: 409 }),
    failClosedRead(fetchPlatformAuthorityApi<IntakeRuntimeOverview>("/intake/runtime", { signal: AbortSignal.timeout(5000) })),
    commercialPromise,
  ]);

  const identityDiagnostic = identityResult.ok ? identityResult.data : null;
  const identityUserBridgeLinked = identityDiagnostic?.bridge.user.status === "linked";
  const identityOrganizationBridgeLinked =
    !identityDiagnostic?.selectedOrganization ||
    identityDiagnostic.bridge.organization.status === "linked";
  const identityBridgeHealthy =
    Boolean(identityDiagnostic) &&
    identityUserBridgeLinked &&
    identityOrganizationBridgeLinked;
  const identityAuthorityAgrees =
    !identityDiagnostic ||
    identityDiagnostic.platformOperator.authorized === hasPlatformAuthority;

  const sessionCount = sessionsResult.ok ? sessionsResult.data.sessions.length : null;
  const currentSessionVisible = sessionsResult.ok
    ? sessionsResult.data.sessions.some((item) => item.current)
    : false;
  const recentActivity = auditResult.ok ? auditResult.data.audit_logs : null;
  const memberCount = membersResult.ok ? membersResult.data.members.length : null;
  const apiKeys = apiKeysResult.ok ? apiKeysResult.data.keys : null;
  const webhookEndpoints = webhooksResult.ok ? webhooksResult.data.endpoints : null;
  const intakeRuntime = intakeResult.ok ? intakeResult.data : null;
  const intakeReachable = intakeRuntime?.runtime.health.reachable ?? false;

  const refreshedAt = new Date().toISOString();
  const environmentLabel = titleCase(process.env.MIGRATECK_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown");
  const evaluatedAt = Date.parse(refreshedAt);
  const activeApiKeys = apiKeys?.filter((item) => item.status === "ACTIVE").length ?? null;
  const expiringApiKeys = apiKeys?.filter((item) => {
    if (item.status !== "ACTIVE" || !item.expiresAt) return false;
    const expiresAt = Date.parse(item.expiresAt);
    return Number.isFinite(expiresAt) && expiresAt > evaluatedAt && expiresAt - evaluatedAt <= 30 * 24 * 60 * 60 * 1000;
  }).length ?? null;
  const unhealthyWebhooks = webhookEndpoints?.filter((item) => item.status === "DISABLED" || item.failCount > 0).length ?? null;
  const activeWebhooks = webhookEndpoints?.filter((item) => item.status === "ACTIVE").length ?? null;

  const commercialChecks = Object.values(commercial.availability);
  const commercialAvailableCount = commercialChecks.filter(Boolean).length;
  const commercialFullyAvailable = commercialChecks.every(Boolean);
  const commercialPartiallyAvailable = commercialAvailableCount > 0 && !commercialFullyAvailable;
  const dunningNeedsAttention = commercial.availability.dunning
    && !["healthy", "none"].includes(commercial.dunningState.toLowerCase());
  const hasActiveSubscription = commercial.availability.subscriptions
    && commercial.subscriptions.some((subscription) => ["active", "trialing"].includes(subscription.status.toLowerCase()));

  const enabledProductFamilies = commercial.availability.entitlements
    ? Array.from(new Set(
      Object.entries(commercial.entitlements)
        .filter(([, value]) => (typeof value === "number" && value > 0) || value === true)
        .map(([key]) => key.split(".")[0])
        .filter((family): family is string => Boolean(family)),
    )).sort()
    : null;

  const developersState: HealthState = !orgId
    ? "context"
    : !apiKeysResult.ok && !webhooksResult.ok
      ? "unavailable"
      : !apiKeysResult.ok || !webhooksResult.ok
        ? "degraded"
        : (unhealthyWebhooks ?? 0) > 0 || (expiringApiKeys ?? 0) > 0
          ? "attention"
          : "operational";

  const commerceState: HealthState = !orgId
    ? "context"
    : commercialAvailableCount === 0
      ? "unavailable"
      : commercialPartiallyAvailable
        ? "degraded"
        : dunningNeedsAttention
          ? "attention"
          : "operational";

  const trustState: HealthState =
    !identityResult.ok && !sessionsResult.ok && !auditResult.ok
      ? "unavailable"
      : !identityResult.ok || !sessionsResult.ok || !auditResult.ok
        ? "degraded"
        : !identityBridgeHealthy || !identityAuthorityAgrees || !currentSessionVisible
          ? "attention"
          : "operational";

  const organizationsState: HealthState = organizations.length === 0
    ? "context"
    : !membersResult.ok
      ? "degraded"
      : "operational";

  const infrastructureState: HealthState = !hasPlatformAuthority
    ? "context"
    : !intakeResult.ok && (!orgId || !hostingResult.ok)
      ? "unavailable"
      : !intakeResult.ok || (orgId ? !hostingResult.ok : false)
        ? "degraded"
        : !intakeReachable
          ? "attention"
          : !orgId
            ? "context"
            : "operational";

  const domainStates: Record<(typeof domains)[number]["key"], HealthState> = {
    developers: developersState,
    commerce: commerceState,
    trust: trustState,
    organizations: organizationsState,
    infrastructure: infrastructureState,
  };

  const operationalDomainCount = Object.values(domainStates).filter((state) => state === "operational").length;

  const attentionItems = [
    !identityResult.ok
      ? {
          title: "Identity bridge diagnostic unavailable",
          detail: "The parent Platform could not verify MigraAuth identity and bridge state.",
          href: "/platform/trust",
          severity: "danger" as const,
        }
      : !identityBridgeHealthy
        ? {
            title: "Identity bridge needs reconciliation",
            detail:
              "User bridge: " +
              identityDiagnostic!.bridge.user.status.replace(/_/g, " ") +
              " · organization bridge: " +
              identityDiagnostic!.bridge.organization.status.replace(/_/g, " ") +
              ".",
            href: "/platform/organizations",
            severity: "warn" as const,
          }
        : !identityAuthorityAgrees
          ? {
              title: "Platform authority context is inconsistent",
              detail:
                "The browser session and MigraAuth platform-operator authority do not agree. Refresh or reconcile the operator session before high-risk changes.",
              href: "/platform/trust",
              severity: "warn" as const,
            }
          : null,
    !sessionsResult.ok
      ? { title: "Identity session visibility unavailable", detail: "MigraAuth session data could not be verified from this overview.", href: "/platform/security", severity: "danger" as const }
      : !currentSessionVisible
        ? { title: "Current browser session is not confirmed", detail: "Authentication is active, but the session inventory does not mark this browser as current.", href: "/platform/security", severity: "warn" as const }
        : null,
    !auditResult.ok
      ? { title: "Governance evidence unavailable", detail: "Recent MigraAuth audit evidence could not be loaded. No quiet or healthy state is inferred.", href: "/platform/compliance", severity: "danger" as const }
      : null,
    orgId && !membersResult.ok
      ? { title: "Membership visibility unavailable", detail: "The active organization's member state could not be verified.", href: "/platform/members", severity: "warn" as const }
      : memberCount !== null && memberCount <= 1
        ? { title: "Single-admin dependency", detail: "Only one member is visible in the active organization. Add an administrative backup.", href: "/platform/members", severity: "warn" as const }
        : null,
    commercialAvailableCount === 0 && orgId
      ? { title: "Commerce authority unavailable", detail: "Billing and entitlement sources could not be verified for the active organization.", href: "/platform/commerce", severity: "danger" as const }
      : commercialPartiallyAvailable
        ? { title: "Commerce visibility is partial", detail: String(commercialAvailableCount) + "/" + String(commercialChecks.length) + " commercial sources are currently available.", href: "/platform/commerce", severity: "warn" as const }
        : null,
    dunningNeedsAttention
      ? { title: "Billing action required", detail: "Dunning state: " + titleCase(commercial.dunningState) + ".", href: "/platform/billing", severity: "danger" as const }
      : null,
    hasActiveSubscription && commercial.availability.paymentMethods && commercial.paymentMethods.length === 0
      ? { title: "No payment method on file", detail: "An active subscription exists without a visible payment method.", href: "/platform/billing", severity: "warn" as const }
      : null,
    unhealthyWebhooks !== null && unhealthyWebhooks > 0
      ? { title: "Webhook delivery health needs attention", detail: String(unhealthyWebhooks) + " endpoint" + (unhealthyWebhooks === 1 ? "" : "s") + " are disabled or reporting failures.", href: "/platform/developers/webhooks", severity: "danger" as const }
      : null,
    expiringApiKeys !== null && expiringApiKeys > 0
      ? { title: "API keys approaching expiry", detail: String(expiringApiKeys) + " active key" + (expiringApiKeys === 1 ? "" : "s") + " expire within 30 days.", href: "/platform/developers/api-keys", severity: "warn" as const }
      : null,
    hasPlatformAuthority && !intakeResult.ok
      ? { title: "MigraIntake runtime visibility unavailable", detail: "The parent Platform could not verify the global legacy Intake runtime.", href: "/platform/intake", severity: "warn" as const }
      : hasPlatformAuthority && !intakeReachable
        ? { title: "MigraIntake runtime needs attention", detail: "The legacy Intake health endpoint is not reporting reachable.", href: "/platform/intake", severity: "danger" as const }
        : null,
    hasPlatformAuthority && orgId && !hostingResult.ok
      ? { title: "Hosting runtime visibility unavailable", detail: "The active organization's hosting bridge could not be verified.", href: "/platform/hosting", severity: "warn" as const }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  const metricAttentionTone = attentionItems.some((item) => item.severity === "danger")
    ? "danger" as const
    : attentionItems.length > 0
      ? "warn" as const
      : "good" as const;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-[radial-gradient(circle_at_12%_10%,rgba(37,99,235,.12),transparent_30%),radial-gradient(circle_at_86%_4%,rgba(124,58,237,.08),transparent_26%),linear-gradient(135deg,#ffffff_0%,#f8fbff_52%,#f8fafc_100%)] shadow-sm">
        <div className="flex flex-col gap-6 p-5 sm:p-6 lg:flex-row lg:items-end lg:justify-between lg:p-7">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">Parent platform</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-800">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {environmentLabel}
              </span>
              <span className="rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                {orgContext?.name ?? "Parent authority"}
              </span>
            </div>
            <h1 className="mt-3 font-[var(--font-display)] text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
              Welcome back, {ownerName}
            </h1>
            <p className="mt-2 max-w-3xl text-[15px] leading-6 text-slate-700">
              One executive surface for identity, developer access, commerce, organizations, infrastructure bridges, security, governance, product readiness, and the items that need operator attention.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] font-medium text-slate-600">
              <span className="inline-flex items-center gap-1.5"><LockKeyhole size={13} /> Authority: <strong className="font-semibold text-slate-700">{authorityLabel}</strong></span>
              <span className="inline-flex items-center gap-1.5"><RefreshCw size={13} /> Refreshed {formatDate(refreshedAt)}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/platform/trust"
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              Trust center <ShieldCheck size={15} />
            </Link>
            <Link
              href="/platform/commerce"
              className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              Open commerce <ArrowRight size={15} />
            </Link>
          </div>
        </div>

        <div className="grid border-t border-slate-200/80 bg-white/70 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Platform health", String(operationalDomainCount) + "/" + String(domains.length), operationalDomainCount === domains.length ? "All parent domains operational" : "One or more domains need review"],
            ["Active organization", orgContext?.name ?? "None", organizations.length > 0 ? String(organizations.length) + " accessible organization" + (organizations.length === 1 ? "" : "s") : "Parent authority remains available"],
            ["Effective permissions", String(session.permissions.length), "Current parent-platform session"],
            ["Attention queue", String(attentionItems.length), attentionItems.length === 0 ? "No immediate operator action" : "Items surfaced below"],
          ].map(([label, value, detail], index) => (
            <div key={label} className={"px-5 py-4 " + (index > 0 ? "border-t border-slate-200/80 sm:border-t-0 sm:border-l " : "") + (index === 2 ? "lg:border-l" : "")}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
              <p className="mt-1 truncate text-lg font-semibold text-slate-950">{value}</p>
              <p className="mt-1 text-[13px] text-slate-600">{detail}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard
          label="Organizations"
          value={String(organizations.length)}
          detail={orgContext ? orgContext.name + " is the active business scope." : "No organization scope selected."}
          icon={Building2}
          tone={organizations.length > 0 ? "good" : "warn"}
        />
        <MetricCard
          label="Members"
          value={memberCount === null ? "Unavailable" : String(memberCount)}
          detail={memberCount === null ? "Membership source did not verify." : "Visible in the active organization."}
          icon={Users}
          tone={memberCount === null ? "danger" : memberCount <= 1 ? "warn" : "good"}
        />
        <MetricCard
          label="Security sessions"
          value={sessionCount === null ? "Unavailable" : String(sessionCount)}
          detail={sessionCount === null ? "Session authority could not be read." : currentSessionVisible ? "Current browser session confirmed." : "Current browser session not confirmed."}
          icon={ShieldCheck}
          tone={sessionCount === null ? "danger" : currentSessionVisible ? "good" : "warn"}
        />
        <MetricCard
          label="API keys"
          value={activeApiKeys === null ? "Unavailable" : String(activeApiKeys)}
          detail={activeApiKeys === null ? "Developer credential source unavailable." : expiringApiKeys ? String(expiringApiKeys) + " expiring within 30 days." : "No near-term expiry surfaced."}
          icon={KeyRound}
          tone={activeApiKeys === null ? "danger" : expiringApiKeys ? "warn" : "default"}
        />
        <MetricCard
          label="Active products"
          value={enabledProductFamilies === null ? "Unavailable" : String(enabledProductFamilies.length)}
          detail={enabledProductFamilies === null ? "Entitlement source unavailable." : enabledProductFamilies.length > 0 ? enabledProductFamilies.map(titleCase).join(", ") : "No enabled product entitlement surfaced."}
          icon={Layers3}
          tone={enabledProductFamilies === null ? "danger" : "default"}
        />
        <MetricCard
          label="Attention"
          value={String(attentionItems.length)}
          detail={attentionItems.length === 0 ? "No immediate platform issue surfaced." : "Operator review recommended."}
          icon={BellRing}
          tone={metricAttentionTone}
        />
      </div>

      <div className="mt-6 grid gap-5 2xl:grid-cols-[1.35fr_.65fr]">
        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-5 sm:px-6 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Platform domains</p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">Shared infrastructure health</h2>
              <p className="mt-1 text-[13px] leading-5 text-slate-600 sm:text-sm">Live authority and readiness signals, without converting unavailable data into false zeroes.</p>
            </div>
            <Link href="/platform/trust" className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700">
              Review trust <ArrowRight size={14} />
            </Link>
          </div>

          <div className="grid gap-px bg-slate-200 md:grid-cols-2">
            {domains.map((domain) => {
              const Icon = domain.icon;
              const state = domainStates[domain.key];
              const detail = domain.key === "developers"
                ? apiKeysResult.ok && webhooksResult.ok
                  ? String(activeApiKeys ?? 0) + " active key" + (activeApiKeys === 1 ? "" : "s") + " · " + String(activeWebhooks ?? 0) + " active webhook" + (activeWebhooks === 1 ? "" : "s")
                  : orgId ? "Developer controls could not be fully verified." : "Select an organization for developer resources."
                : domain.key === "commerce"
                  ? commercialFullyAvailable
                    ? String(commercial.subscriptions.length) + " subscription" + (commercial.subscriptions.length === 1 ? "" : "s") + " · " + String(commercial.invoices.length) + " invoice" + (commercial.invoices.length === 1 ? "" : "s")
                    : orgId ? String(commercialAvailableCount) + "/" + String(commercialChecks.length) + " commerce sources available" : "Select an organization for commercial state."
                  : domain.key === "trust"
                    ? identityResult.ok && sessionsResult.ok && auditResult.ok
                      ? (identityBridgeHealthy ? "Identity linked" : "Identity bridge drift") + " · " + String(sessionCount ?? 0) + " session" + (sessionCount === 1 ? "" : "s") + " · " + String(recentActivity?.length ?? 0) + " recent audit event" + (recentActivity?.length === 1 ? "" : "s")
                      : "Identity, session, or governance evidence is partially unavailable."
                    : domain.key === "infrastructure"
                      ? !hasPlatformAuthority
                        ? "Platform operator authority is required for global Intake visibility."
                        : intakeResult.ok
                          ? (intakeReachable
                              ? "Intake online · " + String(intakeRuntime?.legacy.counts.projects ?? 0) + " legacy project" + ((intakeRuntime?.legacy.counts.projects ?? 0) === 1 ? "" : "s")
                              : "Intake health needs attention")
                            + " · "
                            + (orgId
                              ? hostingResult.ok
                                ? "Hosting bridge visible"
                                : "Hosting visibility unavailable"
                              : "Select an organization for Hosting")
                          : "Intake runtime visibility unavailable."
                      : memberCount !== null
                        ? String(memberCount) + " member" + (memberCount === 1 ? "" : "s") + " in the active scope"
                        : organizations.length > 0 ? "Organization membership could not be verified." : "No organization scope is required for parent authority.";

              return (
                <Link
                  key={domain.key}
                  href={domain.href}
                  className="group bg-white p-5 transition hover:bg-slate-50/80 sm:p-6"
                >
                  <div className="flex items-start justify-between gap-4">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-600 transition group-hover:bg-blue-600 group-hover:text-white">
                      <Icon size={18} />
                    </span>
                    <span className={"inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold " + healthClasses(state)}>
                      <span className={"h-1.5 w-1.5 rounded-full " + statusDotClasses(state)} />
                      {healthLabel(state)}
                    </span>
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-slate-950">{domain.title}</h3>
                  <p className="mt-1.5 text-[14px] leading-6 text-slate-700">{domain.description}</p>
                  <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                    <p className="min-w-0 truncate text-[13px] font-medium text-slate-600">{detail}</p>
                    <ArrowRight size={14} className="shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-blue-600" />
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Operator queue</p>
            <div className="mt-1 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold tracking-tight text-slate-950">Attention required</h2>
              <span className={"rounded-full px-2.5 py-1 text-[12px] font-semibold " + (attentionItems.length === 0 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>
                {attentionItems.length}
              </span>
            </div>
          </div>

          {attentionItems.length === 0 ? (
            <div className="p-5 sm:p-6">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                <CheckCircle2 size={21} className="text-emerald-600" />
                <p className="mt-3 text-sm font-semibold text-emerald-900">No immediate issue surfaced</p>
                <p className="mt-1 text-sm leading-6 text-emerald-700">Identity, governance, organization, developer, and commercial checks did not surface an action item.</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {attentionItems.slice(0, 6).map((item) => (
                <Link key={item.title} href={item.href} className="group flex gap-3 px-5 py-4 transition hover:bg-slate-50 sm:px-6">
                  <span className={"mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg " + (item.severity === "danger" ? "bg-rose-50 text-rose-600" : "bg-amber-50 text-amber-600")}>
                    <AlertTriangle size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                    <p className="mt-1 text-[13px] leading-5 text-slate-600">{item.detail}</p>
                  </div>
                  <ArrowRight size={14} className="mt-2 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-blue-600" />
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.05fr_.95fr]">
        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-6">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Product estate</p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">Entitlement readiness</h2>
            </div>
            <Link href="/platform/commerce/catalog" className="text-sm font-semibold text-blue-600 hover:text-blue-700">Catalog</Link>
          </div>

          {enabledProductFamilies === null ? (
            <div className="p-5 sm:p-6">
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                Entitlement authority is unavailable. Product access is not being inferred.
              </div>
            </div>
          ) : enabledProductFamilies.length === 0 ? (
            <div className="p-5 sm:p-6">
              <p className="text-sm text-slate-600">No enabled product entitlement is currently visible for this organization.</p>
            </div>
          ) : (
            <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-6 lg:grid-cols-3">
              {enabledProductFamilies.slice(0, 9).map((family) => (
                <Link
                  key={family}
                  href={productRoutes[family] ?? "/platform/commerce/catalog"}
                  className="group rounded-2xl border border-slate-200 bg-slate-50/70 p-4 transition hover:border-blue-200 hover:bg-white"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-blue-600 shadow-sm">
                      <Layers3 size={16} />
                    </span>
                    <span className="rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-emerald-700">Enabled</span>
                  </div>
                  <p className="mt-3 text-sm font-semibold text-slate-950">{titleCase(family)}</p>
                  <p className="mt-1 text-[13px] text-slate-600">Entitlement-backed access</p>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-6">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Security & governance</p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">Control posture</h2>
            </div>
            <Link href="/platform/security" className="text-sm font-semibold text-blue-600 hover:text-blue-700">Security</Link>
          </div>

          <div className="grid gap-px bg-slate-100 sm:grid-cols-2">
            {[
              {
                label: "Session authority",
                value: sessionCount === null ? "Unavailable" : currentSessionVisible ? "Verified" : "Review",
                detail: sessionCount === null ? "MigraAuth session inventory unavailable." : String(sessionCount) + " visible browser/device session" + (sessionCount === 1 ? "" : "s") + ".",
                icon: ShieldCheck,
                tone: sessionCount === null ? "danger" : currentSessionVisible ? "good" : "warn",
                href: "/platform/security",
              },
              {
                label: "Governance evidence",
                value: recentActivity === null ? "Unavailable" : "Tracked",
                detail: recentActivity === null ? "Audit source unavailable." : String(recentActivity.length) + " recent identity/governance event" + (recentActivity.length === 1 ? "" : "s") + " visible.",
                icon: ReceiptText,
                tone: recentActivity === null ? "danger" : "good",
                href: "/platform/compliance",
              },
              {
                label: "Machine credentials",
                value: activeApiKeys === null ? "Unavailable" : String(activeApiKeys),
                detail: activeApiKeys === null ? "API-key authority unavailable." : expiringApiKeys ? String(expiringApiKeys) + " near expiry." : "No near-term expiry surfaced.",
                icon: KeyRound,
                tone: activeApiKeys === null ? "danger" : expiringApiKeys ? "warn" : "default",
                href: "/platform/developers/api-keys",
              },
              {
                label: "Webhook delivery",
                value: webhookEndpoints === null ? "Unavailable" : unhealthyWebhooks ? "Attention" : "Healthy",
                detail: webhookEndpoints === null ? "Webhook authority unavailable." : String(activeWebhooks ?? 0) + " active endpoint" + (activeWebhooks === 1 ? "" : "s") + "; " + String(unhealthyWebhooks ?? 0) + " unhealthy.",
                icon: Webhook,
                tone: webhookEndpoints === null ? "danger" : unhealthyWebhooks ? "warn" : "good",
                href: "/platform/developers/webhooks",
              },
            ].map((item) => {
              const Icon = item.icon;
              const toneClass = item.tone === "good"
                ? "text-emerald-600"
                : item.tone === "warn"
                  ? "text-amber-600"
                  : item.tone === "danger"
                    ? "text-rose-600"
                    : "text-blue-600";
              return (
                <Link key={item.label} href={item.href} className="group bg-white p-5 transition hover:bg-slate-50">
                  <div className="flex items-center justify-between gap-3">
                    <Icon size={17} className={toneClass} />
                    <ArrowRight size={13} className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-blue-600" />
                  </div>
                  <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{item.label}</p>
                  <p className="mt-1 text-base font-semibold text-slate-950">{item.value}</p>
                  <p className="mt-1 text-[13px] leading-5 text-slate-600">{item.detail}</p>
                </Link>
              );
            })}
          </div>
        </section>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-6">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Governance evidence</p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">Recent identity activity</h2>
            </div>
            <Link href="/platform/compliance" className="text-sm font-semibold text-blue-600 hover:text-blue-700">Open audit</Link>
          </div>

          {recentActivity === null ? (
            <div className="p-5 sm:p-6">
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                Audit evidence is unavailable. The overview is not treating this as an empty activity stream.
              </div>
            </div>
          ) : recentActivity.length === 0 ? (
            <p className="p-5 text-sm text-slate-600 sm:p-6">No recent identity activity is present for this user.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {recentActivity.slice(0, 8).map((entry) => (
                <div key={entry.id} className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500">
                    <Activity size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{titleCase(entry.event_type)}</p>
                    <p className="mt-0.5 truncate text-[13px] text-slate-600">{entry.ip_address ?? "IP unavailable"}</p>
                  </div>
                  <time dateTime={entry.created_at} className="shrink-0 text-right text-[11px] font-medium text-slate-500 sm:text-[13px]">
                    {formatDate(entry.created_at)}
                  </time>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Commercial readiness</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">{orgContext?.name ?? "No organization selected"}</h2>
          </div>

          <div className="grid gap-px bg-slate-100 sm:grid-cols-2">
            <div className="bg-white p-5">
              <CreditCard size={17} className="text-violet-600" />
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Billing account</p>
              <p className="mt-1 text-base font-semibold text-slate-950">
                {!commercial.availability.account ? "Unavailable" : commercial.account?.status ? titleCase(commercial.account.status) : "Not configured"}
              </p>
            </div>
            <div className="bg-white p-5">
              <CircleDollarSign size={17} className="text-emerald-600" />
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Subscriptions</p>
              <p className="mt-1 text-base font-semibold text-slate-950">
                {commercial.availability.subscriptions ? String(commercial.subscriptions.length) : "Unavailable"}
              </p>
            </div>
            <div className="bg-white p-5">
              <Gauge size={17} className="text-blue-600" />
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Usage meters</p>
              <p className="mt-1 text-base font-semibold text-slate-950">
                {commercial.availability.usageSummary ? String(commercial.usageSummary.length) : "Unavailable"}
              </p>
            </div>
            <div className="bg-white p-5">
              <BadgeDollarSign size={17} className={dunningNeedsAttention ? "text-rose-600" : "text-slate-600"} />
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Dunning</p>
              <p className="mt-1 text-base font-semibold text-slate-950">
                {commercial.availability.dunning ? titleCase(commercial.dunningState) : "Unavailable"}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-slate-100 p-5 sm:px-6">
            <Link href="/platform/billing" className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-[12px] font-semibold text-white hover:bg-blue-700">
              Open billing <ArrowRight size={13} />
            </Link>
            <Link href="/platform/usage" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-[12px] font-semibold text-slate-700 hover:bg-slate-50">
              Usage & metering <Gauge size={13} />
            </Link>
          </div>
        </section>
      </div>

      <section className="mt-6 rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Operator shortcuts</p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">Common control-plane actions</h2>
        </div>
        <div className="grid gap-px overflow-hidden rounded-b-3xl bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { title: "Manage members", detail: "Review access and administrative backup.", href: "/platform/members", icon: Users },
            { title: "Review API keys", detail: "Inspect machine credentials and expiry.", href: "/platform/developers/api-keys", icon: KeyRound },
            { title: "Inspect webhooks", detail: "Review endpoint and delivery health.", href: "/platform/developers/webhooks", icon: Webhook },
            { title: "Open security", detail: "Sessions, MFA, and identity controls.", href: "/platform/security", icon: ShieldCheck },
          ].map((action) => {
            const Icon = action.icon;
            return (
              <Link key={action.href} href={action.href} className="group bg-white p-5 transition hover:bg-slate-50">
                <div className="flex items-center justify-between gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-blue-600"><Icon size={16} /></span>
                  <ArrowRight size={14} className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-blue-600" />
                </div>
                <p className="mt-3 text-sm font-semibold text-slate-950">{action.title}</p>
                <p className="mt-1 text-[13px] leading-5 text-slate-600">{action.detail}</p>
              </Link>
            );
          })}
        </div>
      </section>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 px-1 text-[12px] leading-5 text-slate-500 sm:text-[13px]">
        <span className="inline-flex items-center gap-1.5"><Clock3 size={12} /> Unavailable sources remain explicitly unavailable; zero is shown only when a source responded successfully.</span>
        <span className="inline-flex items-center gap-1.5"><CreditCard size={12} /> Product execution remains in products; operator execution remains in MigraPanel.</span>
      </div>
    </div>
  );
}
