import Link from "next/link";
import { LinkButton } from "@/components/ui/button";
import type { VpsDashboardPayload, VpsFleetItem, VpsFleetProviderStatus, VpsFleetWorkspace, VpsProviderControlMode, VpsProviderHealthState } from "@/lib/vps/types";
import { VpsActionBarClient } from "@/components/app/vps-action-bar-client";
import { listSupportedVpsImages } from "@/lib/vps/images";

function formatDate(value?: string) {
  if (!value) {
    return "Not scheduled";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value?: string) {
  if (!value) {
    return "No activity yet";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatMoney(cents: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

function formatUptime(seconds: number) {
  if (!seconds) {
    return "Fresh";
  }

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }

  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function ratioPercent(current: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round((current / total) * 100)));
}

function sparklinePoints(values: number[]) {
  if (values.length <= 1) {
    return "0,24 100,24";
  }

  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);

  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = 24 - ((value - min) / range) * 20;
      return `${x},${y}`;
    })
    .join(" ");
}

function actionClass(enabled: boolean, tone: "neutral" | "caution" | "danger") {
  if (!enabled) {
    return "cursor-not-allowed rounded-xl border border-slate-200 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-400";
  }

  if (tone === "danger") {
    return "rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700";
  }

  if (tone === "caution") {
    return "rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800";
  }

  return "rounded-xl border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-2)]";
}

function providerControlModeLabel(mode: VpsProviderControlMode) {
  switch (mode) {
    case "LIVE_API":
      return "Live API";
    case "STUB":
      return "Stub-backed";
    case "MIXED":
      return "Mixed";
    default:
      return "Runtime missing";
  }
}

function providerControlModeClass(mode: VpsProviderControlMode) {
  switch (mode) {
    case "LIVE_API":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "STUB":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "MIXED":
      return "border-sky-200 bg-sky-50 text-sky-700";
    default:
      return "border-rose-200 bg-rose-50 text-rose-800";
  }
}

function providerHealthLabel(state: VpsProviderHealthState) {
  switch (state) {
    case "HEALTHY":
      return "Healthy";
    case "DEGRADED":
      return "Degraded";
    case "UNREACHABLE":
      return "Unreachable";
    default:
      return "Unknown";
  }
}

function providerHealthClass(state: VpsProviderHealthState) {
  switch (state) {
    case "HEALTHY":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "DEGRADED":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "UNREACHABLE":
      return "border-rose-200 bg-rose-50 text-rose-800";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

export function VpsSectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <article className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{title}</h2>
          {description ? <p className="mt-1 text-sm text-[var(--ink-muted)]">{description}</p> : null}
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </article>
  );
}

export function VpsStatusBadge({ status }: { status: string }) {
  const tone =
    status === "RUNNING"
      ? "border-emerald-200/60 bg-emerald-50 text-emerald-600"
      : status === "STOPPED" || status === "SUSPENDED"
        ? "border-slate-200 bg-slate-50 text-slate-500"
        : status === "ERROR" || status === "TERMINATED"
          ? "border-rose-200/60 bg-rose-50 text-rose-600"
          : status === "PROVISIONING" || status === "REBOOTING" || status === "REBUILDING"
            ? "border-indigo-200/60 bg-indigo-50 text-indigo-600"
            : "border-amber-200/60 bg-amber-50 text-amber-600";

  return (
    <span className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tone}`}>
      {status}
    </span>
  );
}

export function VpsServerTabs({
  serverId,
  features,
}: {
  serverId: string;
  features: Pick<VpsDashboardPayload["features"], "console" | "firewall" | "snapshots" | "backups" | "monitoring">;
}) {
  const tabs = [
    { href: `/app/vps/${serverId}`, label: "Overview", enabled: true },
    { href: `/app/vps/${serverId}/console`, label: "Console", enabled: features.console },
    { href: `/app/vps/${serverId}/networking`, label: "Networking", enabled: true },
    { href: `/app/vps/${serverId}/firewall`, label: "Firewall", enabled: features.firewall },
    { href: `/app/vps/${serverId}/snapshots`, label: "Snapshots", enabled: features.snapshots },
    { href: `/app/vps/${serverId}/backups`, label: "Backups", enabled: features.backups },
    { href: `/app/vps/${serverId}/monitoring`, label: "Monitoring", enabled: features.monitoring },
    { href: `/app/vps/${serverId}/billing`, label: "Billing", enabled: true },
    { href: `/app/vps/${serverId}/support`, label: "Support", enabled: true },
    { href: `/app/vps/${serverId}/activity`, label: "Activity", enabled: true },
    { href: `/app/vps/${serverId}/settings`, label: "Settings", enabled: true },
  ].filter((tab) => tab.enabled);

  return (
    <nav className="flex flex-wrap gap-2">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm font-semibold text-[var(--ink-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

export function VpsActionBar({
  serverId,
  serverName,
  providerSlug,
  currentImageSlug,
  currentOsName,
  actions,
  features,
  powerState,
}: {
  serverId: string;
  serverName: string;
  providerSlug: string;
  currentImageSlug: string;
  currentOsName: string;
  actions: VpsDashboardPayload["actions"];
  features: VpsDashboardPayload["features"];
  powerState: VpsDashboardPayload["server"]["powerState"];
}) {
  const availableImages = listSupportedVpsImages(providerSlug);

  return (
    <div id="vps-server-actions" className="flex flex-wrap gap-2 rounded-2xl border border-[var(--line)] bg-white p-4 shadow-sm">
      {actions.canOpenConsole ? (
        <LinkButton href={`/app/vps/${serverId}/console`} variant="secondary">Open Console</LinkButton>
      ) : (
        <span className={actionClass(false, "neutral")}>Console unavailable</span>
      )}
      {features.firewall ? (
        <Link href={`/app/vps/${serverId}/firewall`} className={actionClass(true, "neutral")}>Firewall</Link>
      ) : (
        <span className={actionClass(false, "neutral")}>Firewall unavailable</span>
      )}
      {features.snapshots ? (
        <Link href={`/app/vps/${serverId}/snapshots`} className={actionClass(true, "neutral")}>Snapshots</Link>
      ) : (
        <span className={actionClass(false, "neutral")}>Snapshots unavailable</span>
      )}
      {features.backups ? (
        <Link href={`/app/vps/${serverId}/backups`} className={actionClass(true, "neutral")}>Backups</Link>
      ) : (
        <span className={actionClass(false, "neutral")}>Backups unavailable</span>
      )}
      <Link href={`/app/vps/${serverId}/networking`} className={actionClass(true, "neutral")}>Networking</Link>
      {features.monitoring ? (
        <Link href={`/app/vps/${serverId}/monitoring`} className={actionClass(true, "neutral")}>Monitoring</Link>
      ) : (
        <span className={actionClass(false, "neutral")}>Monitoring unavailable</span>
      )}
      <Link href={`/app/vps/${serverId}/support`} className={actionClass(true, "neutral")}>Support</Link>
      <div className="basis-full" />
      <VpsActionBarClient
        serverId={serverId}
        serverName={serverName}
        currentImageSlug={currentImageSlug}
        currentOsName={currentOsName}
        availableImages={availableImages}
        powerState={powerState}
        canPowerControl={actions.canPowerControl}
        canSync={actions.canSync}
        canReboot={actions.canReboot}
        canRescue={actions.canRescue}
        canRebuild={actions.canRebuild}
        rebuildEnabled={features.rebuild}
      />
    </div>
  );
}

export function VpsMetricCard({
  label,
  value,
  helper,
  values,
  accent = "#005fbf",
}: {
  label: string;
  value: string;
  helper: string;
  values: number[];
  accent?: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">{label}</p>
      <p className="mt-2 text-2xl font-black tracking-tight">{value}</p>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">{helper}</p>
      <div className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2">
        <svg viewBox="0 0 100 24" className="h-8 w-full" preserveAspectRatio="none" aria-hidden="true">
          <polyline
            fill="none"
            stroke={accent}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={sparklinePoints(values.length ? values : [0, 0])}
          />
        </svg>
      </div>
    </div>
  );
}

export function VpsDetailGrid({
  items,
}: {
  items: Array<{ label: string; value: string }>;
}) {
  return (
    <dl className="grid gap-3 md:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3">
          <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">{item.label}</dt>
          <dd className="mt-1 text-sm font-semibold text-[var(--ink)]">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function VpsActivityTimeline({
  items,
}: {
  items: VpsDashboardPayload["activity"];
}) {
  if (!items.length) {
    return <p className="text-sm text-[var(--ink-muted)]">No VPS audit events yet. New jobs and actions will appear here.</p>;
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.id} className="flex gap-3 rounded-xl border border-[var(--line)] px-4 py-3">
          <div className="mt-1 h-2.5 w-2.5 rounded-full bg-[var(--brand-600)]" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-[var(--ink)]">{item.message}</p>
              <span className="text-xs font-medium text-[var(--ink-muted)]">{formatDateTime(item.createdAt)}</span>
            </div>
            <p className="mt-1 text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">
              {item.type} · {item.actor} · {item.status}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function VpsEmptyState({
  title,
  description,
  href,
  cta,
}: {
  title: string;
  description: string;
  href?: string;
  cta?: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--line)] bg-white p-8 text-center shadow-sm">
      <h1 className="text-2xl font-black tracking-tight">{title}</h1>
      <p className="mx-auto mt-2 max-w-2xl text-sm text-[var(--ink-muted)]">{description}</p>
      {href && cta ? (
        <div className="mt-5">
          <LinkButton href={href} variant="secondary">{cta}</LinkButton>
        </div>
      ) : null}
    </div>
  );
}

function bannerToneClass(tone: NonNullable<VpsFleetWorkspace["banner"]>["tone"]) {
  if (tone === "danger") {
    return "border-rose-200 bg-rose-50 text-rose-900";
  }

  if (tone === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }

  return "border-sky-200 bg-sky-50 text-sky-900";
}

export function VpsFleetStateBanner({
  banner,
  lastSyncedAt,
}: {
  banner: NonNullable<VpsFleetWorkspace["banner"]>;
  lastSyncedAt?: string;
}) {
  return (
    <div className={`rounded-2xl border px-4 py-3 shadow-sm ${bannerToneClass(banner.tone)}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em]">Operational state</p>
          <p className="mt-1 text-sm font-semibold">{banner.title}</p>
          <p className="mt-1 text-sm opacity-90">{banner.description}</p>
        </div>
        <p className="text-xs font-medium opacity-80">Last fleet sync {formatDateTime(lastSyncedAt)}</p>
      </div>
    </div>
  );
}

export function VpsFleetSummaryCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-white px-4 py-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">{label}</p>
      <p className="mt-2 text-2xl font-black tracking-tight text-[var(--ink)]">{value}</p>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">{helper}</p>
    </div>
  );
}

type VpsWorkspaceModule = {
  title: string;
  description: string;
  status: "ACTIVE" | "READY" | "ATTENTION" | "PENDING";
  detail?: string;
  href?: string;
  actionLabel?: string;
};

function moduleStatusTone(status: "ACTIVE" | "READY" | "ATTENTION" | "PENDING") {
  if (status === "ACTIVE") {
    return "border-emerald-200/60 bg-emerald-50 text-emerald-600";
  }

  if (status === "READY") {
    return "border-indigo-200/60 bg-indigo-50 text-indigo-600";
  }

  if (status === "ATTENTION") {
    return "border-amber-200/60 bg-amber-50 text-amber-600";
  }

  return "border-slate-200 bg-slate-50 text-slate-500";
}

function providerFabricStatus(provider: VpsFleetProviderStatus) {
  if (!provider.configured || !provider.runtimeConfigured || provider.state === "OFFLINE") {
    return {
      label: "Offline",
      className: "border-rose-200 bg-rose-50 text-rose-700",
      dotClass: "bg-rose-500",
    };
  }

  if (provider.healthState !== "HEALTHY" || provider.controlMode !== "LIVE_API") {
    return {
      label: "Degraded",
      className: provider.healthState === "UNREACHABLE"
        ? "border-rose-200 bg-rose-50 text-rose-800"
        : "border-amber-200 bg-amber-50 text-amber-800",
      dotClass: provider.healthState === "UNREACHABLE" ? "bg-rose-500" : "bg-amber-500",
    };
  }

  return {
    label: "Active",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    dotClass: "bg-emerald-500",
  };
}

function cloudSyncLabel(sync: VpsFleetWorkspace["sync"]["status"]) {
  switch (sync) {
    case "HEALTHY":
      return "Synced";
    case "STALE":
      return "Attention";
    case "PENDING_IMPORT":
      return "Pending import";
    default:
      return "Offline";
  }
}

export function VpsCloudControlHero({
  fleet,
  children,
}: {
  fleet: VpsFleetWorkspace;
  children: React.ReactNode;
}) {
  const configuredProviders = fleet.providers.filter((provider) => provider.configured).length;
  const healthyProviders = fleet.providers.filter((provider) => provider.healthState === "HEALTHY").length;
  const stubBackedProviders = fleet.providers.filter((provider) => provider.controlMode === "STUB" || provider.controlMode === "MIXED").length;

  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-[var(--line)] bg-[radial-gradient(circle_at_top_left,rgba(11,127,144,0.18),transparent_32%),linear-gradient(180deg,#ffffff_0%,#f3f8f9_100%)] px-5 py-5 shadow-sm sm:px-6 sm:py-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(90deg,rgba(11,127,144,0.12),rgba(10,22,40,0.02),transparent)]" />
      <div className="relative flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
        <div className="max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--brand-600)]">Cloud infrastructure standard</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-[var(--ink)] sm:text-4xl">MigraHosting Cloud Control</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
            The VPS workspace now acts as the client-facing cloud operating surface for compute, networking, recovery, monitoring, billing, and support. This is the baseline interface current and future clients should recognize as the standard control plane.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="inline-flex items-center rounded-full border border-[var(--line)] bg-white/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-muted)] shadow-[0_8px_18px_rgba(10,22,40,0.05)]">Compute fleet</span>
            <span className="inline-flex items-center rounded-full border border-[var(--line)] bg-white/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-muted)] shadow-[0_8px_18px_rgba(10,22,40,0.05)]">Network and access</span>
            <span className="inline-flex items-center rounded-full border border-[var(--line)] bg-white/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-muted)] shadow-[0_8px_18px_rgba(10,22,40,0.05)]">Protection and recovery</span>
            <span className="inline-flex items-center rounded-full border border-[var(--line)] bg-white/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-muted)] shadow-[0_8px_18px_rgba(10,22,40,0.05)]">Observability and support</span>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-[var(--line)] bg-white/92 px-4 py-4 shadow-[0_12px_24px_rgba(10,22,40,0.04)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">Compute estate</p>
              <p className="mt-2 text-2xl font-black tracking-tight text-[var(--ink)]">{fleet.summary.total}</p>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">{fleet.summary.running} running nodes visible in this client workspace. {fleet.summary.drifted} drifted. {fleet.summary.incidentOpen} with open incidents.</p>
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-white/92 px-4 py-4 shadow-[0_12px_24px_rgba(10,22,40,0.04)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">Provider fabric</p>
              <p className="mt-2 text-2xl font-black tracking-tight text-[var(--ink)]">{configuredProviders}</p>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                {stubBackedProviders > 0
                  ? `${healthyProviders} healthy provider links and ${stubBackedProviders} stub-backed provider ${stubBackedProviders === 1 ? "surface" : "surfaces"} are currently visible.`
                  : `${healthyProviders} healthy provider control ${healthyProviders === 1 ? "link is" : "links are"} ready for import, sync, and lifecycle actions.`}
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-white/92 px-4 py-4 shadow-[0_12px_24px_rgba(10,22,40,0.04)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">Control posture</p>
              <p className="mt-2 text-2xl font-black tracking-tight text-[var(--ink)]">{cloudSyncLabel(fleet.sync.status)}</p>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">{fleet.sync.lastSyncedAt ? `Last fleet reconciliation ${formatDateTime(fleet.sync.lastSyncedAt)}.` : "No fleet reconciliation has been recorded yet."}</p>
            </div>
          </div>
        </div>

        <div className="w-full xl:max-w-[560px]">{children}</div>
      </div>
    </section>
  );
}

export function VpsCloudControlBar({
  fleet,
  children,
}: {
  fleet: VpsFleetWorkspace;
  children: React.ReactNode;
}) {
  const connectedProviders = fleet.providers.filter((provider) => provider.configured).length;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-slate-200/60 bg-white px-5 py-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_32px_rgba(0,0,0,0.04)] sm:px-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-indigo-500/40 via-purple-400/25 to-transparent" />
      <div className="relative flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold tracking-[-0.02em] text-slate-900 sm:text-[32px]">Cloud Control</h1>
          <p className="mt-1.5 text-[13px] text-slate-500">
            {fleet.summary.total} {fleet.summary.total === 1 ? "server" : "servers"} · {connectedProviders} {connectedProviders === 1 ? "provider" : "providers"} · last sync {formatDateTime(fleet.sync.lastSyncedAt)}
          </p>
        </div>
        <div className="w-full xl:w-auto xl:min-w-[520px]">{children}</div>
      </div>
    </section>
  );
}

export function VpsGlobalStatusStrip({ fleet }: { fleet: VpsFleetWorkspace }) {
  const healthyProviders = fleet.providers.filter((provider) => provider.healthState === "HEALTHY" && provider.runtimeConfigured).length;
  const offlineProviders = fleet.providers.filter((provider) => !provider.runtimeConfigured || provider.state === "OFFLINE").length;
  const degradedProviders = Math.max(fleet.providers.length - healthyProviders - offlineProviders, 0);
  const toneClass = {
    success: "border-emerald-200 bg-emerald-50 text-emerald-700",
    warning: "border-amber-200 bg-amber-50 text-amber-700",
    danger: "border-rose-200 bg-rose-50 text-rose-700",
    neutral: "border-slate-200 bg-slate-100 text-slate-700",
  } as const;

  const items = [
    {
      label: "Fleet sync",
      value: fleet.sync.status === "HEALTHY" ? "Healthy" : fleet.sync.status === "STALE" ? "Attention" : fleet.sync.status === "PENDING_IMPORT" ? "Pending" : "Offline",
      helper: fleet.sync.staleServerCount > 0 ? `${fleet.sync.staleServerCount} stale` : fleet.sync.status === "HEALTHY" ? "Fresh" : "Pending",
      tone: fleet.sync.status === "HEALTHY" ? "success" : fleet.sync.status === "STALE" ? "warning" : "neutral",
    },
    {
      label: "Provider health",
      value: `${healthyProviders} healthy / ${offlineProviders} offline`,
      helper: degradedProviders > 0 ? `${degradedProviders} degraded` : "Visible",
      tone: offlineProviders > 0 ? "warning" : degradedProviders > 0 ? "warning" : "success",
    },
    {
      label: "Incidents",
      value: `${fleet.summary.incidentOpen} open`,
      helper: fleet.summary.incidentOpen > 0 ? "Needs review" : "Clear",
      tone: fleet.summary.incidentOpen > 0 ? "danger" : "success",
    },
    {
      label: "Drift",
      value: `${fleet.summary.drifted} detected`,
      helper: fleet.summary.drifted > 0 ? "Review" : "Stable",
      tone: fleet.summary.drifted > 0 || fleet.sync.staleServerCount > 0 ? "warning" : "success",
    },
    {
      label: "Protection",
      value: `${fleet.summary.protected}/${fleet.summary.total || 0} protected`,
      helper: fleet.summary.total ? `${fleet.summary.monitored}/${fleet.summary.total} monitored` : "No servers",
      tone: fleet.summary.total > 0 && fleet.summary.protected === fleet.summary.total ? "success" : fleet.summary.protected > 0 ? "warning" : "neutral",
    },
  ];

  return (
    <section className="flex flex-wrap gap-2">
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-slate-200/60 bg-white px-3.5 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
          <span className={`h-2 w-2 shrink-0 rounded-full ${item.tone === "success" ? "bg-emerald-500" : item.tone === "warning" ? "bg-amber-500" : item.tone === "danger" ? "bg-rose-500" : "bg-slate-300"}`} />
          <span className="text-[13px] font-medium text-slate-600">{item.label}</span>
          <span className={`ml-auto whitespace-nowrap text-[13px] font-semibold tabular-nums ${item.tone === "success" ? "text-emerald-600" : item.tone === "warning" ? "text-amber-600" : item.tone === "danger" ? "text-rose-600" : "text-slate-600"}`}>{item.value}</span>
          <span className="hidden text-[11px] text-slate-400 sm:inline">{item.helper}</span>
        </div>
      ))}
    </section>
  );
}

export function VpsFleetAttentionBanner({
  banner,
  lastSyncedAt,
}: {
  banner: NonNullable<VpsFleetWorkspace["banner"]>;
  lastSyncedAt?: string | undefined;
}) {
  const toneClass = banner.tone === "danger"
    ? "border-rose-200 bg-rose-50 text-rose-900"
    : banner.tone === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : "border-sky-200 bg-sky-50 text-sky-900";

  return (
    <section className={`flex flex-col gap-3 rounded-2xl border px-5 py-4 lg:flex-row lg:items-center lg:justify-between ${toneClass}`}>
      <div className="min-w-0">
        <p className="text-[13px] font-semibold">{banner.title}</p>
        <p className="mt-1 text-[13px] opacity-80">{banner.description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[11px] opacity-60">Last fleet sync {formatDateTime(lastSyncedAt)}</span>
        <a href="#vps-fleet-actions" className="inline-flex items-center justify-center rounded-lg bg-current/10 px-4 py-2 text-[13px] font-semibold transition hover:bg-current/15">
          Sync now
        </a>
        <a href="#vps-fleet-inventory" className="inline-flex items-center justify-center rounded-lg border border-current/15 bg-white px-4 py-2 text-[13px] font-semibold transition hover:bg-white/80">
          View server
        </a>
      </div>
    </section>
  );
}

export function VpsProviderFabricPanel({ providers }: { providers: VpsFleetProviderStatus[] }) {
  return (
    <section id="vps-provider-fabric" className="rounded-2xl border border-slate-200/60 bg-white px-5 py-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_32px_rgba(0,0,0,0.04)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold tracking-tight text-slate-900">Provider Fabric</h3>
        <a href="#vps-fleet-actions" className="text-[12px] font-medium text-slate-400 transition hover:text-slate-700">
          Manage
        </a>
      </div>
      <div className="space-y-2">
        {providers.map((provider) => {
          const fabricStatus = providerFabricStatus(provider);
          const iconLabel = provider.label.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
          const controlModeLabel = providerControlModeLabel(provider.controlMode);
          const runtimeReady = provider.runtimeConfigured && provider.configured;

          return (
            <div key={provider.slug} className="rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3.5 transition hover:bg-slate-50">
              <div className="flex items-start gap-3">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold ${provider.configured ? "bg-indigo-50 text-indigo-700" : "bg-slate-200 text-slate-500"}`}>
                  {iconLabel}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[14px] font-semibold text-slate-900">{provider.label}</p>
                    <span className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${providerControlModeClass(provider.controlMode)}`}>
                      {controlModeLabel}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${fabricStatus.dotClass}`} />
                    <span className={`text-[12px] font-medium ${fabricStatus.label === "Active" ? "text-emerald-600" : fabricStatus.label === "Degraded" ? "text-amber-600" : "text-rose-600"}`}>{fabricStatus.label}</span>
                    <span className="text-[11px] text-slate-400">·</span>
                    <span className="text-[11px] text-slate-400">{provider.serverCount} {provider.serverCount === 1 ? "server" : "servers"}</span>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-4 text-slate-400">
                    {runtimeReady ? "Runtime ready" : "Action required"} · {provider.healthDetail || provider.detail}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className={`inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${runtimeReady ? "border-emerald-200/60 bg-emerald-50 text-emerald-600" : "border-slate-200 bg-slate-100 text-slate-500"}`}>
                      {runtimeReady ? "Ready" : "Needs setup"}
                    </span>
                    <span className="text-[10px] text-slate-400">Last check {formatDateTime(provider.healthCheckedAt || provider.lastSyncedAt)}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function VpsIncidentSummaryCard({ fleet }: { fleet: VpsFleetWorkspace }) {
  const escalationState = fleet.summary.incidentOpen > 0
    ? { label: "Action required", className: "border-rose-200/60 bg-rose-50 text-rose-600" }
    : fleet.summary.drifted > 0 || fleet.sync.staleServerCount > 0
      ? { label: "Watchlist", className: "border-amber-200/60 bg-amber-50 text-amber-600" }
      : { label: "Clear", className: "border-emerald-200/60 bg-emerald-50 text-emerald-600" };

  return (
    <section className="rounded-2xl border border-slate-200/60 bg-white px-5 py-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_32px_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold tracking-tight text-slate-900">Active Incidents</h3>
        <span className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${escalationState.className}`}>
          {escalationState.label}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-slate-400">Synced {formatDateTime(fleet.sync.lastSyncedAt)}</p>
      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/60 px-3.5 py-3">
          <span className="text-[13px] text-slate-600">Stale servers</span>
          <span className={`text-[13px] font-semibold tabular-nums ${fleet.sync.staleServerCount > 0 ? "text-amber-600" : "text-slate-900"}`}>{fleet.sync.staleServerCount}</span>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/60 px-3.5 py-3">
          <span className="text-[13px] text-slate-600">Drift detected</span>
          <span className={`text-[13px] font-semibold tabular-nums ${fleet.summary.drifted > 0 ? "text-amber-600" : "text-slate-900"}`}>{fleet.summary.drifted}</span>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/60 px-3.5 py-3">
          <span className="text-[13px] text-slate-600">Open incidents</span>
          <span className={`text-[13px] font-semibold tabular-nums ${fleet.summary.incidentOpen > 0 ? "text-rose-600" : "text-slate-900"}`}>{fleet.summary.incidentOpen}</span>
        </div>
      </div>
      <p className="mt-3 text-[11px] leading-4 text-slate-400">
        {fleet.summary.incidentOpen > 0
          ? "Escalations are active. Reconcile now, then inspect affected servers."
          : "No active escalations. Continue monitoring sync freshness and drift posture."}
      </p>
      <a href="#vps-fleet-actions" className="mt-4 inline-flex w-full items-center justify-center rounded-lg border border-slate-200/60 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50">
        {fleet.summary.incidentOpen > 0 || fleet.summary.drifted > 0 || fleet.sync.staleServerCount > 0 ? "Run reconciliation" : "Review fleet"}
      </a>
    </section>
  );
}

export function VpsFleetOpsSidebar({
  fleet,
}: {
  fleet: VpsFleetWorkspace;
}) {
  const healthyProviders = fleet.providers.filter((provider) => provider.healthState === "HEALTHY" && provider.runtimeConfigured).length;

  return (
    <div className="space-y-3">
      <VpsProviderFabricPanel providers={fleet.providers} />

      <section className="rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-[0_12px_32px_rgba(15,23,42,0.05)]">
        <div className="mb-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Incidents</p>
          <h3 className="mt-1 text-base font-semibold tracking-tight text-slate-950">Active incidents</h3>
        </div>
        <div className="space-y-2">
          {fleet.summary.incidentOpen > 0 ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-3">
              <p className="text-sm font-semibold text-rose-900">{fleet.summary.incidentOpen} {fleet.summary.incidentOpen === 1 ? "incident open" : "incidents open"}</p>
              <p className="mt-1 text-xs text-rose-800">Critical alerts or SLA risks need operator review.</p>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 px-3 py-5 text-center">
              <p className="text-sm font-semibold text-slate-950">No open incidents</p>
              <p className="mt-1 text-xs text-slate-600">New critical events will surface here.</p>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-[0_12px_32px_rgba(15,23,42,0.05)]">
        <div className="mb-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Reconciliation</p>
          <h3 className="mt-1 text-base font-semibold tracking-tight text-slate-950">Fleet state</h3>
        </div>
        <dl className="space-y-2 text-sm">
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
            <dt className="text-slate-600">Last fleet sync</dt>
            <dd className="font-semibold text-slate-950">{formatDateTime(fleet.sync.lastSyncedAt)}</dd>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
            <dt className="text-slate-600">Stale servers</dt>
            <dd className={`font-semibold ${fleet.sync.staleServerCount > 0 ? "text-amber-700" : "text-slate-950"}`}>{fleet.sync.staleServerCount}</dd>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
            <dt className="text-slate-600">Drift detected</dt>
            <dd className={`font-semibold ${fleet.summary.drifted > 0 ? "text-amber-700" : "text-slate-950"}`}>{fleet.summary.drifted}</dd>
          </div>
        </dl>
        <a href="#vps-fleet-actions" className="mt-3 inline-flex w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-50">
          Run reconciliation
        </a>
      </section>

      <section className="rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-[0_12px_32px_rgba(15,23,42,0.05)]">
        <div className="mb-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Spend</p>
          <h3 className="mt-1 text-base font-semibold tracking-tight text-slate-950">Monthly total</h3>
        </div>
        <p className="text-3xl font-semibold tracking-tight text-slate-950">{formatMoney(fleet.summary.monthlyTotalCents)}</p>
        <p className="mt-1 text-xs text-slate-600">Visible recurring infrastructure spend · {healthyProviders} healthy provider links</p>
        <Link href="/app/billing" className="mt-3 inline-flex w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-50">
          View billing
        </Link>
      </section>
    </div>
  );
}

export function VpsOperationsPanel({
  fleet,
}: {
  fleet: VpsFleetWorkspace;
}) {
  const cards = [
    {
      title: "Compute",
      status: fleet.summary.total > 0 ? "ACTIVE" : "PENDING",
      metric: `${fleet.summary.running} running`,
      detail: fleet.summary.total > 0 ? `${fleet.summary.total - fleet.summary.running} not currently online` : "Import inventory to activate lifecycle actions",
      href: "#vps-fleet-inventory",
      actionLabel: "Open",
    },
    {
      title: "Network",
      status: fleet.providers.some((provider) => provider.configured) ? "READY" : "PENDING",
      metric: fleet.summary.unreachable > 0 ? `${fleet.summary.unreachable} offline` : "Provider connectivity present",
      detail: fleet.providers.some((provider) => provider.configured) ? `${fleet.providers.filter((provider) => provider.runtimeConfigured).length}/${fleet.providers.length} runtimes ready` : "No provider runtime connected yet",
      href: "#vps-provider-fabric",
      actionLabel: "Open access",
    },
    {
      title: "Protection",
      status: fleet.summary.total > 0 && fleet.summary.protected === fleet.summary.total ? "ACTIVE" : fleet.summary.protected > 0 ? "ATTENTION" : "PENDING",
      metric: fleet.summary.total > 0 ? `Backups enabled on ${fleet.summary.protected}/${fleet.summary.total}` : "Awaiting servers",
      detail: fleet.summary.total > 0 ? `${fleet.summary.total - fleet.summary.protected} servers still need coverage` : "Protection posture starts after import",
      href: "#vps-fleet-inventory",
      actionLabel: "Inspect",
    },
    {
      title: "Monitoring",
      status: fleet.summary.total > 0 && fleet.summary.monitored === fleet.summary.total ? "ACTIVE" : fleet.summary.monitored > 0 ? "ATTENTION" : "PENDING",
      metric: fleet.summary.total > 0 ? `${fleet.summary.monitored}/${fleet.summary.total} healthy` : "Awaiting telemetry",
      detail: fleet.summary.total > 0 ? `${fleet.summary.total - fleet.summary.monitored} servers missing telemetry` : "Monitoring becomes visible after sync",
      href: "#vps-fleet-inventory",
      actionLabel: "Track health",
    },
  ] as const;

  return (
    <section className="rounded-2xl border border-slate-200/60 bg-white px-5 py-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_32px_rgba(0,0,0,0.04)]">
      <div className="mb-4">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">Operations</h2>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <article key={card.title} className="group rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-4 transition hover:border-slate-200 hover:bg-white hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] font-semibold text-slate-800">{card.title}</p>
              <span className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${moduleStatusTone(card.status)}`}>
                {card.status}
              </span>
            </div>
            <p className="mt-3 text-[13px] leading-5 text-slate-700">{card.metric}</p>
            <p className="mt-1.5 text-[12px] leading-5 text-slate-400">{card.detail}</p>
            <a href={card.href} className="mt-4 inline-flex w-full items-center justify-center rounded-lg border border-slate-200/60 bg-white px-4 py-2 text-[13px] font-medium text-slate-600 transition hover:text-slate-900">
              {card.actionLabel}
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}

export function VpsPlatformPosture({
  fleet,
}: {
  fleet: VpsFleetWorkspace;
}) {
  const protectedPercent = ratioPercent(fleet.summary.protected, fleet.summary.total);
  const monitoredPercent = ratioPercent(fleet.summary.monitored, fleet.summary.total);
  const runtimeReadyPercent = ratioPercent(
    fleet.providers.filter((provider) => provider.runtimeConfigured).length,
    fleet.providers.length,
  );
  const runningPercent = ratioPercent(fleet.summary.running, fleet.summary.total);
  const recommendations = [
    fleet.sync.status !== "HEALTHY" ? "Run fleet sync" : null,
    fleet.providers.some((provider) => !provider.runtimeConfigured) ? "Connect provider runtime" : null,
    fleet.summary.drifted > 0 ? "Review drifted servers" : null,
    fleet.summary.total > 0 && fleet.summary.protected < fleet.summary.total ? "Close backup coverage gaps" : null,
    fleet.summary.total > 0 && fleet.summary.monitored < fleet.summary.total ? "Restore monitoring coverage" : null,
  ].filter(Boolean).slice(0, 4) as string[];

  return (
    <div className="grid grid-cols-12 gap-5 xl:gap-6">
      <section className="col-span-12 rounded-2xl border border-slate-200/60 bg-white px-5 py-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_32px_rgba(0,0,0,0.04)] xl:col-span-8">
        <div className="mb-5">
          <h3 className="text-lg font-semibold tracking-tight text-slate-900">Operating Posture</h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] text-slate-600">Provider orchestration</span>
              <p className="text-[13px] font-semibold tabular-nums text-slate-900">{fleet.providers.filter((provider) => provider.runtimeConfigured).length}/{fleet.providers.length || 0} ready</p>
            </div>
            <div className="mt-3 h-1.5 rounded-full bg-slate-200">
              <div className="h-1.5 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-500" style={{ width: `${runtimeReadyPercent}%` }} />
            </div>
            <p className="mt-2 text-[11px] text-slate-400">{runtimeReadyPercent}% runtime coverage</p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] text-slate-600">Fleet reconciliation</span>
              <p className={`text-[13px] font-semibold ${fleet.sync.status === "HEALTHY" ? "text-emerald-600" : "text-amber-600"}`}>{cloudSyncLabel(fleet.sync.status)}</p>
            </div>
            <div className="mt-3 h-1.5 rounded-full bg-slate-200">
              <div className={`h-1.5 rounded-full transition-all duration-500 ${fleet.sync.status === "HEALTHY" ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: `${fleet.sync.status === "HEALTHY" ? 100 : 42}%` }} />
            </div>
            <p className="mt-2 text-[11px] text-slate-400">{fleet.sync.staleServerCount} stale servers currently outside the freshness window</p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] text-slate-600">Protection coverage</span>
              <p className="text-[13px] font-semibold tabular-nums text-slate-900">{fleet.summary.protected}/{fleet.summary.total || 0}</p>
            </div>
            <div className="mt-3 h-1.5 rounded-full bg-slate-200">
              <div className="h-1.5 rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${protectedPercent}%` }} />
            </div>
            <p className="mt-2 text-[11px] text-slate-400">{protectedPercent}% of visible servers have recovery posture enabled</p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] text-slate-600">Live workload state</span>
              <p className="text-[13px] font-semibold tabular-nums text-slate-900">{fleet.summary.running}/{fleet.summary.total || 0} online</p>
            </div>
            <div className="mt-3 h-1.5 rounded-full bg-slate-200">
              <div className="h-1.5 rounded-full bg-sky-500 transition-all duration-500" style={{ width: `${runningPercent}%` }} />
            </div>
            <p className="mt-2 text-[11px] text-slate-400">{monitoredPercent}% telemetry coverage across visible infrastructure</p>
          </div>
        </div>
      </section>

      <div className="col-span-12 grid gap-5 xl:col-span-4">
        <section className="rounded-2xl border border-slate-200/60 bg-white px-5 py-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_32px_rgba(0,0,0,0.04)]">
          <h3 className="text-lg font-semibold tracking-tight text-slate-900">Monthly Spend</h3>
          <p className="mt-4 text-[40px] font-semibold leading-none tabular-nums tracking-tight text-slate-900">
            {formatMoney(fleet.summary.monthlyTotalCents)}
            <span className="ml-1 text-[24px] font-normal text-slate-400">/mo</span>
          </p>
          <div className="mt-4 h-px w-full bg-gradient-to-r from-indigo-500/30 via-purple-400/20 to-transparent" />
          <p className="mt-3 text-[12px] text-slate-500">Visible recurring infrastructure spend</p>
          <Link href="/app/billing" className="mt-4 inline-flex w-full items-center justify-center rounded-lg border border-slate-200/60 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50">
            View billing
          </Link>
        </section>

        <section className="rounded-2xl border border-slate-200/60 bg-white px-5 py-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_32px_rgba(0,0,0,0.04)]">
          <h3 className="text-lg font-semibold tracking-tight text-slate-900">Next Steps</h3>
          <div className="mt-4 space-y-2.5 text-[13px] text-slate-600">
            {recommendations.length ? recommendations.map((item) => (
              <div key={item} className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-[10px] text-slate-400">✓</span>
                <p>{item}</p>
              </div>
            )) : <p className="text-[13px] text-slate-500">The fleet is stable. Open a server workspace or provider card for deeper operations.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}

export function VpsCloudModuleGrid({ fleet }: { fleet: VpsFleetWorkspace }) {
  const modules = [
    {
      title: "Compute Fleet",
      status: fleet.summary.total > 0 ? "ACTIVE" : fleet.canImportFromProviders ? "READY" : "PENDING",
      description: fleet.summary.total > 0
        ? `${fleet.summary.running} of ${fleet.summary.total} instances are currently online and available for operator actions.`
        : "Inventory is empty, but this workspace is prepared to receive imported or newly provisioned servers.",
      href: "#vps-fleet-inventory",
      action: "View inventory",
    },
    {
      title: "Network and Access",
      status: fleet.providers.some((provider) => provider.configured) ? "READY" : "PENDING",
      description: fleet.providers.some((provider) => provider.configured)
        ? "Provider connectivity is present, which enables console, network-state refresh, and edge-level coordination once servers are attached."
        : "Provider credentials still need to be connected before this workspace can become authoritative for live infrastructure access.",
      href: "#vps-provider-strip",
      action: "Review providers",
    },
    {
      title: "Protection and Recovery",
      status: fleet.summary.total === 0 ? "READY" : fleet.summary.protected === fleet.summary.total ? "ACTIVE" : fleet.summary.protected > 0 ? "ATTENTION" : "PENDING",
      description: fleet.summary.total === 0
        ? "Backup, snapshot, and firewall standards are staged here before the first workload enters the fleet."
        : `${fleet.summary.protected} servers currently report backup protection across the visible fleet surface.`,
      href: "#vps-fleet-inventory",
      action: "Inspect protection",
    },
    {
      title: "Observability and Support",
      status: fleet.summary.total === 0 ? "READY" : fleet.summary.monitored === fleet.summary.total ? "ACTIVE" : fleet.summary.monitored > 0 ? "ATTENTION" : "PENDING",
      description: fleet.summary.total === 0
        ? "Monitoring and support workflows are available as part of the standard platform contract for incoming clients."
        : `${fleet.summary.monitored} servers currently report healthy monitoring signals into the operator surface.`,
      href: "#vps-fleet-inventory",
      action: "Track health",
    },
    {
      title: "Client Operations",
      status: fleet.prefersVpsWorkspace ? "ACTIVE" : "PENDING",
      description: fleet.summary.monthlyTotalCents > 0
        ? `${formatMoney(fleet.summary.monthlyTotalCents)} in visible recurring infrastructure spend is currently represented in this workspace.`
        : "This workspace is active for the client org and ready to serve as the standard cloud-control entry point.",
      href: "#vps-fleet-actions",
      action: "Open actions",
    },
  ] as const;

  return (
    <div className="grid gap-3 lg:grid-cols-5">
      {modules.map((module) => (
        <article key={module.title} className="rounded-[1.4rem] border border-[var(--line)] bg-white px-4 py-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-semibold text-[var(--ink)]">{module.title}</p>
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${moduleStatusTone(module.status)}`}>
              {module.status}
            </span>
          </div>
          <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">{module.description}</p>
          <a href={module.href} className="mt-4 inline-flex text-xs font-semibold uppercase tracking-[0.14em] text-[var(--brand-600)]">
            {module.action}
          </a>
        </article>
      ))}
    </div>
  );
}

export function VpsCloudStandardPanel({
  fleet,
  deployHref,
}: {
  fleet: VpsFleetWorkspace;
  deployHref: string;
}) {
  const liveProviders = fleet.providers.filter((provider) => provider.controlMode === "LIVE_API").length;
  const impairedProviders = fleet.providers.filter((provider) => provider.runtimeConfigured && (provider.healthState === "DEGRADED" || provider.healthState === "UNREACHABLE")).length;
  const stubProviders = fleet.providers.filter((provider) => provider.controlMode === "STUB" || provider.controlMode === "MIXED").length;
  const readinessItems = [
    {
      label: "Provider orchestration",
      value: liveProviders > 0 ? `${liveProviders} live API` : stubProviders > 0 ? "Stub-backed" : "Awaiting credentials",
    },
    {
      label: "Fleet reconciliation",
      value: cloudSyncLabel(fleet.sync.status),
    },
    {
      label: "Protection coverage",
      value: fleet.summary.total ? `${fleet.summary.protected}/${fleet.summary.total} nodes` : "Policies staged",
    },
    {
      label: "Monitoring coverage",
      value: fleet.summary.total ? `${fleet.summary.monitored}/${fleet.summary.total} nodes` : "Signals staged",
    },
    {
      label: "Provider health",
      value: impairedProviders > 0 ? `${impairedProviders} impaired` : "Healthy",
    },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-[1.25fr_0.95fr]">
      <article className="rounded-[1.6rem] border border-[var(--line)] bg-white px-5 py-5 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">Client standard</p>
        <h2 className="mt-2 text-2xl font-black tracking-tight text-[var(--ink)]">Every client should land in a complete cloud operating surface</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">
          This landing screen establishes the standard platform contract for current and future clients: visible compute inventory, clear provider status, protection posture, observability signals, lifecycle actions, and an unambiguous path to deploy or import infrastructure.
        </p>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-4 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Compute and access</p>
            <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">Fleet inventory, server detail workspaces, power actions, console launch, and network-facing coordination belong here.</p>
          </div>
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-4 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Recovery and continuity</p>
            <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">Backups, snapshots, rebuild, rescue, and firewall policy should read like first-class platform controls, not afterthought tooling.</p>
          </div>
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-4 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Observability and support</p>
            <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">Monitoring signals, activity history, billing posture, and support escalation should remain visible from the first screen.</p>
          </div>
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-4 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Onboarding and scale</p>
            <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">The same surface must work for a new client with zero nodes and an established client operating multiple providers and environments.</p>
          </div>
        </div>
      </article>

      <article className="rounded-[1.6rem] border border-[var(--line)] bg-[linear-gradient(180deg,#ffffff_0%,#f7fbfc_100%)] px-5 py-5 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">Operating posture</p>
        <div className="mt-4 space-y-3">
          {readinessItems.map((item) => (
            <div key={item.label} className="rounded-xl border border-[var(--line)] bg-white px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">{item.label}</p>
              <p className="mt-1 text-sm font-semibold text-[var(--ink)]">{item.value}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href="#vps-fleet-actions" className="rounded-xl border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-2)]">
            Open control actions
          </a>
          <LinkButton href={deployHref} variant="secondary">Deploy capacity</LinkButton>
        </div>
      </article>
    </div>
  );
}

export function VpsWorkspaceSectionHeader({
  eyebrow,
  title,
  description,
  meta,
}: {
  eyebrow: string;
  title: string;
  description: string;
  meta?: string;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="max-w-3xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-muted)]">{eyebrow}</p>
        <h2 className="mt-1 text-2xl font-black tracking-tight text-[var(--ink)]">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">{description}</p>
      </div>
      {meta ? <p className="text-sm font-semibold text-[var(--ink-muted)]">{meta}</p> : null}
    </div>
  );
}

export function VpsWorkspaceModuleGrid({ modules }: { modules: VpsWorkspaceModule[] }) {
  return (
    <div className="grid gap-3 lg:grid-cols-4">
      {modules.map((module) => (
        <article key={module.title} className="rounded-[1.35rem] border border-[var(--line)] bg-white px-4 py-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-semibold text-[var(--ink)]">{module.title}</p>
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${moduleStatusTone(module.status)}`}>
              {module.status}
            </span>
          </div>
          <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">{module.description}</p>
          {module.detail ? <p className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">{module.detail}</p> : null}
          {module.href && module.actionLabel ? (
            <a href={module.href} className="mt-4 inline-flex text-xs font-semibold uppercase tracking-[0.14em] text-[var(--brand-600)]">
              {module.actionLabel}
            </a>
          ) : null}
        </article>
      ))}
    </div>
  );
}

export function VpsServerCommandDeck({ payload }: { payload: VpsDashboardPayload }) {
  const modules: VpsWorkspaceModule[] = [
    {
      title: "Provider control",
      status: payload.control.mode === "LIVE_API"
        ? (payload.sync.isStale || payload.control.healthState === "DEGRADED" || payload.control.healthState === "UNREACHABLE" ? "ATTENTION" : "ACTIVE")
        : payload.control.mode === "UNCONFIGURED"
          ? "ATTENTION"
          : "READY",
      description: `Bound to ${payload.server.providerSlug}${payload.server.providerServerId ? ` with provider ID ${payload.server.providerServerId}` : " with a local-only binding"}. ${payload.control.detail}`,
      detail: `${providerControlModeLabel(payload.control.mode)} · ${providerHealthLabel(payload.control.healthState)}${payload.sync.lastSyncedAt ? ` · Last sync ${formatDateTime(payload.sync.lastSyncedAt)}` : " · Never synced"}`,
      href: "/app/vps",
      actionLabel: "Open fleet",
    },
    {
      title: "Access and console",
      status: payload.features.console ? "ACTIVE" : payload.actions.canOpenConsole ? "READY" : "PENDING",
      description: payload.features.console
        ? `Interactive console access is enabled. SSH endpoint ${payload.server.sshEndpoint} remains the direct operator path.`
        : `SSH remains available via ${payload.server.sshEndpoint} while managed console support is unavailable for this provider binding.`,
      detail: `Power ${payload.server.powerState}`,
      href: `/app/vps/${payload.server.id}/console`,
      actionLabel: "Launch access",
    },
    {
      title: "Protection posture",
      status: payload.server.firewallEnabled && payload.backups.enabled ? "ACTIVE" : payload.server.firewallEnabled || payload.backups.enabled ? "ATTENTION" : "PENDING",
      description: `Firewall ${payload.server.firewallEnabled ? "enabled" : "disabled"}, backups ${payload.backups.enabled ? "active" : "not active"}, and ${payload.snapshots.count} snapshots recorded.`,
      detail: payload.server.firewallProfileName || "Provider-managed protection",
      href: `/app/vps/${payload.server.id}/backups`,
      actionLabel: "Review recovery",
    },
    {
      title: "Operations and support",
      status: payload.server.support.openTicketCount > 0 || payload.sync.pendingActionCount > 0 ? "ATTENTION" : "ACTIVE",
      description: `${payload.sync.pendingActionCount} queued actions and ${payload.server.support.openTicketCount} open support tickets are currently linked to this server.`,
      detail: `${payload.server.support.tier} support`,
      href: `/app/vps/${payload.server.id}/support`,
      actionLabel: "Open operations",
    },
  ];

  return <VpsWorkspaceModuleGrid modules={modules} />;
}

export function VpsProviderStatusStrip({ providers }: { providers: VpsFleetProviderStatus[] }) {
  return (
    <div id="vps-provider-strip" className="grid gap-3 lg:grid-cols-3">
      {providers.map((provider) => (
        <article key={provider.slug} className="rounded-2xl border border-[var(--line)] bg-white px-4 py-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[var(--ink)]">{provider.label}</p>
              <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">Provider {provider.slug}</p>
            </div>
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] ${provider.state === "ACTIVE" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : provider.state === "READY" ? "border-sky-200 bg-sky-50 text-sky-700" : "border-slate-200 bg-slate-100 text-slate-700"}`}>
              {provider.state}
            </span>
          </div>
          <p className="mt-3 text-sm text-[var(--ink-muted)]">{provider.detail}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Runtime API</p>
              <p className="mt-1 text-sm font-semibold text-[var(--ink)]">{provider.runtimeConfigured ? "Configured" : "Missing"}</p>
            </div>
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Control mode</p>
              <p className={`mt-1 inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] ${providerControlModeClass(provider.controlMode)}`}>{providerControlModeLabel(provider.controlMode)}</p>
            </div>
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Provider health</p>
              <p className={`mt-1 inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] ${providerHealthClass(provider.healthState)}`}>{providerHealthLabel(provider.healthState)}</p>
            </div>
          </div>
          <p className="mt-3 text-sm text-[var(--ink-muted)]">{provider.healthDetail}</p>
          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
            {provider.serverCount} {provider.serverCount === 1 ? "server" : "servers"} · {provider.stubServerCount > 0 ? `${provider.stubServerCount} stub-backed` : "No stub-backed nodes"} · Last sync {formatDateTime(provider.lastSyncedAt)}
          </p>
        </article>
      ))}
    </div>
  );
}

export function VpsProviderExecutionBanner({ providers }: { providers: VpsFleetProviderStatus[] }) {
  const stubProviders = providers.filter((provider) => provider.serverCount > 0 && (provider.controlMode === "STUB" || provider.controlMode === "MIXED"));
  const missingRuntimeProviders = providers.filter((provider) => provider.serverCount > 0 && !provider.runtimeConfigured);
  const impairedProviders = providers.filter((provider) => provider.runtimeConfigured && (provider.healthState === "DEGRADED" || provider.healthState === "UNREACHABLE"));

  if (!stubProviders.length && !missingRuntimeProviders.length && !impairedProviders.length) {
    return null;
  }

  const totalStubServers = stubProviders.reduce((sum, provider) => sum + provider.stubServerCount, 0);
  const toneClass = missingRuntimeProviders.length || impairedProviders.some((provider) => provider.healthState === "UNREACHABLE")
    ? "border-rose-200 bg-rose-50 text-rose-900"
    : "border-amber-200 bg-amber-50 text-amber-900";

  return (
    <div className={`rounded-2xl border px-4 py-3 shadow-sm ${toneClass}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.16em]">Provider execution authority</p>
      {stubProviders.length ? (
        <p className="mt-1 text-sm">
          {stubProviders.map((provider) => provider.label).join(", ")} {stubProviders.length === 1 ? "is" : "are"} currently serving live workspace inventory through stub-backed control data for {totalStubServers} {totalStubServers === 1 ? "server" : "servers"}.
        </p>
      ) : null}
      {missingRuntimeProviders.length ? (
        <p className="mt-1 text-sm">
          {missingRuntimeProviders.map((provider) => provider.label).join(", ")} {missingRuntimeProviders.length === 1 ? "is" : "are"} missing runtime API credentials, so inventory visibility does not yet imply live provider authority.
        </p>
      ) : null}
      {impairedProviders.length ? (
        <p className="mt-1 text-sm">
          {impairedProviders.map((provider) => `${provider.label} (${providerHealthLabel(provider.healthState)})`).join(", ")} currently report impaired provider health, so sync and lifecycle control should be treated cautiously until runtime connectivity is restored.
        </p>
      ) : null}
    </div>
  );
}

export function VpsServerControlBanner({ payload }: { payload: VpsDashboardPayload }) {
  if (payload.control.mode === "LIVE_API" && payload.control.healthState === "HEALTHY" && !payload.drift.detected) {
    return null;
  }

  const toneClass = payload.control.mode === "UNCONFIGURED" || payload.control.healthState === "UNREACHABLE"
    ? "border-rose-200 bg-rose-50 text-rose-900"
    : "border-amber-200 bg-amber-50 text-amber-900";

  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm ${toneClass}`}>
      <p>{payload.control.detail}</p>
      <p className="mt-1">{payload.control.healthDetail}</p>
        {payload.drift.detected ? (
          <p className="mt-1">Configuration drift detected{payload.drift.type ? `: ${payload.drift.type.replace(/_/g, " ").toLowerCase()}` : ""}. Use Sync from the action bar to reconcile provider state.</p>
        ) : null}
        {payload.drift.detected ? (
          <a href="#vps-server-actions" className="mt-2 inline-flex text-xs font-semibold uppercase tracking-[0.14em] text-current underline-offset-4 hover:underline">
            Reconcile now
          </a>
        ) : null}
    </div>
  );
}

export function VpsOperationalEmptyState({
  providers,
  canImportFromProviders,
  deployHref,
}: {
  providers: VpsFleetProviderStatus[];
  canImportFromProviders: boolean;
  deployHref: string;
}) {
  const configuredProviders = providers.filter((provider) => provider.configured).length;

  return (
    <div className="rounded-2xl border border-slate-200/60 bg-white px-5 py-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_32px_rgba(0,0,0,0.04)]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">No imported VPS inventory yet</h2>
          <p className="mt-1 max-w-2xl text-[13px] text-slate-500">
            Import inventory or deploy the first node to activate the fleet workspace.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="#vps-fleet-actions" className="rounded-lg border border-slate-200/60 bg-white px-4 py-2 text-[13px] font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900">
            Open actions
          </a>
          <LinkButton href={deployHref} variant="secondary">Deploy</LinkButton>
        </div>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Connected providers</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{configuredProviders}</p>
        </div>
        <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Discovery readiness</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{canImportFromProviders ? "Ready" : "Blocked"}</p>
        </div>
        <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Next milestone</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">First server import</p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-100 bg-white px-4 py-3">
          <p className="text-[13px] font-semibold text-slate-800">Import current estate</p>
          <p className="mt-1 text-[12px] text-slate-500">Discover provider inventory and attach it to this org.</p>
        </div>
        <div className="rounded-xl border border-slate-100 bg-white px-4 py-3">
          <p className="text-[13px] font-semibold text-slate-800">Verify provider runtime</p>
          <p className="mt-1 text-[12px] text-slate-500">Confirm APIs are configured before reconciling the fleet.</p>
        </div>
        <div className="rounded-xl border border-slate-100 bg-white px-4 py-3">
          <p className="text-[13px] font-semibold text-slate-800">Deploy new capacity</p>
          <p className="mt-1 text-[12px] text-slate-500">Open provisioning when you need the first VPS node.</p>
        </div>
      </div>
    </div>
  );
}

export function VpsFleetTable({ servers }: { servers: VpsFleetItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="bg-slate-50/80">
            <th className="border-b border-slate-100 px-5 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-slate-400">Server</th>
            <th className="border-b border-slate-100 px-5 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-slate-400">State</th>
            <th className="border-b border-slate-100 px-5 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-slate-400">Network</th>
            <th className="border-b border-slate-100 px-5 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-slate-400">Plan</th>
            <th className="border-b border-slate-100 px-5 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-slate-400">Protection</th>
            <th className="border-b border-slate-100 px-5 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-slate-400">Cost</th>
            <th className="border-b border-slate-100 px-5 py-3 text-right text-[11px] font-medium uppercase tracking-wider text-slate-400">Actions</th>
          </tr>
        </thead>
        <tbody>
          {servers.map((server) => (
            <tr key={server.id} className="align-top transition hover:bg-slate-50/50">
              <td className="border-b border-slate-100 px-5 py-4 align-top">
                <p className="text-[13px] font-semibold text-slate-900">{server.name}</p>
                <p className="mt-0.5 text-[12px] text-slate-500">{server.hostname}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                  <span className="inline-flex rounded-md border border-indigo-100 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">{server.providerSlug.toUpperCase()}</span>
                  <span>Last sync {formatDateTime(server.lastSyncedAt)}</span>
                </div>
                <p className="mt-1 text-[11px] tabular-nums text-slate-400">{formatMoney(server.monthlyPriceCents, server.billingCurrency)} / month</p>
              </td>
              <td className="border-b border-slate-100 px-5 py-4 align-top">
                <VpsStatusBadge status={server.status} />
                <p className="mt-2 text-[11px] font-medium uppercase tracking-wider text-slate-400">Power {server.powerState}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {server.openAlertCount > 0 ? <span className="inline-flex rounded-md border border-amber-200/60 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">{server.openAlertCount} alerts</span> : null}
                  {server.incidentOpen ? <span className="inline-flex rounded-md border border-rose-200/60 bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-600">Incident</span> : null}
                  {server.driftType ? <span className="inline-flex rounded-md border border-amber-200/60 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">Drift</span> : null}
                </div>
              </td>
              <td className="border-b border-slate-100 px-5 py-4 align-top">
                <p className="text-[13px] font-medium tabular-nums text-slate-900">{server.publicIpv4}</p>
                <p className="mt-0.5 text-[12px] text-slate-500">{server.region}</p>
                <p className="mt-0.5 text-[12px] text-slate-400">{server.osName}</p>
              </td>
              <td className="border-b border-slate-100 px-5 py-4 align-top">
                <p className="text-[13px] text-slate-800">{server.planLabel}</p>
                <p className="mt-0.5 text-[12px] text-slate-400">{server.cpuRamLabel}</p>
              </td>
              <td className="border-b border-slate-100 px-5 py-4 align-top">
                <div className="flex flex-wrap gap-1.5">
                  <span className={`inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${server.backupsEnabled ? "border-emerald-200/60 bg-emerald-50 text-emerald-600" : "border-slate-200 bg-slate-50 text-slate-400"}`}>
                    {server.backupsEnabled ? "Backups" : "No backups"}
                  </span>
                  <span className={`inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${server.firewallEnabled ? "border-indigo-200/60 bg-indigo-50 text-indigo-600" : "border-slate-200 bg-slate-50 text-slate-400"}`}>
                    {server.firewallEnabled ? "Firewall" : "Firewall off"}
                  </span>
                  <span className={`inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${server.monitoringStatus ? "border-emerald-200/60 bg-emerald-50 text-emerald-600" : "border-slate-200 bg-slate-50 text-slate-400"}`}>
                    {server.monitoringStatus ? "Monitoring" : "No monitoring"}
                  </span>
                </div>
                <p className="mt-2 text-[11px] text-slate-400">Renews {formatDate(server.renewalAt)}</p>
              </td>
              <td className="border-b border-slate-100 px-5 py-4 align-top text-[13px] font-semibold tabular-nums text-slate-900">{formatMoney(server.monthlyPriceCents, server.billingCurrency)}/mo</td>
              <td className="border-b border-slate-100 px-5 py-4 align-top">
                <div className="flex justify-end gap-1.5">
                  <Link href={`/app/vps/${server.id}`} className="rounded-lg border border-slate-200/60 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900">
                    Open
                  </Link>
                  <Link href={`/app/vps/${server.id}/console`} className="rounded-lg border border-slate-200/60 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900">
                    Console
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function VpsOverviewHero({ payload }: { payload: VpsDashboardPayload }) {
  const { server } = payload;
  const diagnostics = payload.diagnostics;
  const planLabel = `${server.plan.vcpu} vCPU · ${server.plan.memoryGb} GB RAM · ${server.plan.diskGb} GB NVMe · ${server.plan.bandwidthTb} TB`;

  return (
    <article className="rounded-[1.75rem] border border-[var(--line)] bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-black tracking-tight">{server.name}</h1>
            <VpsStatusBadge status={server.status} />
            <span className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
              Power {server.powerState}
            </span>
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] ${providerControlModeClass(payload.control.mode)}`}>
              {providerControlModeLabel(payload.control.mode)}
            </span>
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] ${providerHealthClass(diagnostics.provider.health)}`}>
              {providerHealthLabel(diagnostics.provider.health)}
            </span>
            {diagnostics.drift.detected ? (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-amber-800">
                Drift Detected
              </span>
            ) : null}
            {diagnostics.alerts.openCount > 0 ? (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-amber-800">
                {diagnostics.alerts.openCount} Open Alert{diagnostics.alerts.openCount === 1 ? "" : "s"}
              </span>
            ) : null}
            {diagnostics.incident ? (
              <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-rose-800">
                Incident {diagnostics.incident.severity}
              </span>
            ) : null}
          </div>
          <p className="text-lg font-semibold text-[var(--ink)]">{server.publicIpv4}</p>
          <p className="text-sm text-[var(--ink-muted)]">{server.sshEndpoint}</p>
          <p className="text-sm text-[var(--ink-muted)]">{server.osName} · {server.region}</p>
          <p className="text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">
            Provider {server.providerSlug}{server.providerServerId ? ` · ${server.providerServerId}` : ""} · {payload.control.providerLabel}
          </p>
        </div>
        <div className="min-w-72 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Plan and billing</p>
          <p className="mt-2 text-sm font-semibold text-[var(--ink)]">{planLabel}</p>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            {formatMoney(server.billing.monthlyPriceCents, server.billing.currency)}/mo · Renews {formatDate(server.billing.renewalAt)}
          </p>
          <p className="mt-2 text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">
            {server.support.tier} support
          </p>
          <p className="mt-2 text-xs text-[var(--ink-muted)]">
            {server.support.openTicketCount} open tickets · Last sync {formatDateTime(diagnostics.server.lastSyncedAt || undefined)}
          </p>
          <p className="mt-2 text-xs text-[var(--ink-muted)]">{payload.control.detail}</p>
          <p className="mt-2 text-xs text-[var(--ink-muted)]">{payload.control.healthDetail}</p>
          {diagnostics.alerts.openCount > 0 ? <p className="mt-2 text-xs text-[var(--ink-muted)]">Alert queue: {diagnostics.alerts.openCount} open / {diagnostics.alerts.criticalCount} critical.</p> : null}
          {diagnostics.drift.detected ? <p className="mt-2 text-xs text-[var(--ink-muted)]">Drift: {diagnostics.drift.type || "Configuration mismatch"}</p> : null}
          {diagnostics.sla ? <p className="mt-2 text-xs text-[var(--ink-muted)]">SLA: {diagnostics.sla.state}</p> : null}
        </div>
      </div>
    </article>
  );
}

export function VpsMonitoringStrip({ payload }: { payload: VpsDashboardPayload }) {
  const { monitoring } = payload;

  return (
    <div className="grid gap-4 xl:grid-cols-6">
      <VpsMetricCard label="CPU usage" value={formatPercent(monitoring.cpuPercent)} helper="24h sample" values={monitoring.cpuSeries} />
      <VpsMetricCard label="Memory usage" value={formatPercent(monitoring.memoryPercent)} helper="24h sample" values={monitoring.memorySeries} accent="#235dbe" />
      <VpsMetricCard label="Disk usage" value={formatPercent(monitoring.diskPercent)} helper="24h sample" values={monitoring.diskSeries} accent="#3b82f6" />
      <VpsMetricCard label="Network in" value={`${Math.round(monitoring.networkInMbps)} Mbps`} helper="Ingress" values={monitoring.networkInSeries} accent="#2563eb" />
      <VpsMetricCard label="Network out" value={`${Math.round(monitoring.networkOutMbps)} Mbps`} helper="Egress" values={monitoring.networkOutSeries} accent="#1d4ed8" />
      <VpsMetricCard label="Uptime" value={formatUptime(monitoring.uptimeSeconds)} helper={payload.server.monitoringStatus || "Monitoring ready"} values={monitoring.cpuSeries} accent="#0f766e" />
    </div>
  );
}

