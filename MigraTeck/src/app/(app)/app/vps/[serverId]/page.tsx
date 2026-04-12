import Link from "next/link";
import { notFound } from "next/navigation";
import { VpsAlertQueue } from "@/components/app/vps-alert-queue";
import { VpsActivityTimeline, VpsDetailGrid, VpsMonitoringStrip } from "@/components/app/vps-ui";
import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import type { VpsAlertEventView } from "@/lib/vps/alerts";
import { getVpsDashboardPayload } from "@/lib/vps/data";

function formatDate(value?: string | null) {
  if (!value) {
    return "Not scheduled";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value?: string | null) {
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

function titleCase(value: string) {
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export default async function VpsOverviewPage({ params }: { params: Promise<{ serverId: string }> }) {
  const { serverId } = await params;
  const session = await requireAuthSession();
  const membership = await getActiveOrgContext(session.user.id);

  if (!membership) {
    notFound();
  }

  const payload = await getVpsDashboardPayload(serverId, membership);

  if (!payload) {
    notFound();
  }

  const diagnostics = payload.diagnostics;
  const summaryCards = [
    {
      label: "Control authority",
      value: titleCase(payload.control.mode),
      helper: payload.control.healthDetail,
      tone: payload.control.mode === "LIVE_API" && payload.control.healthState === "HEALTHY" ? "success" : payload.control.healthState === "UNREACHABLE" ? "danger" : "warning",
    },
    {
      label: "Sync posture",
      value: payload.sync.isStale ? "Stale" : diagnostics.server.lastSyncedAt ? "Fresh" : "Unsynced",
      helper: diagnostics.server.lastSyncedAt ? `Last sync ${formatDateTime(diagnostics.server.lastSyncedAt)}` : "Run an initial provider sync",
      tone: payload.sync.isStale ? "warning" : diagnostics.server.lastSyncedAt ? "success" : "neutral",
    },
    {
      label: "Recovery posture",
      value: payload.backups.enabled ? "Protected" : payload.snapshots.count > 0 ? "Partial" : "Exposed",
      helper: payload.backups.enabled ? `${payload.snapshots.count} snapshots recorded` : "Managed backups are not active",
      tone: payload.backups.enabled ? "success" : payload.snapshots.count > 0 ? "warning" : "danger",
    },
    {
      label: "Telemetry",
      value: payload.server.monitoringStatus || (payload.server.monitoringEnabled ? "Enabled" : "Limited"),
      helper: `${Math.round(payload.monitoring.cpuPercent)}% CPU · ${Math.round(payload.monitoring.memoryPercent)}% memory`,
      tone: payload.server.monitoringEnabled ? "success" : "neutral",
    },
  ] as const;

  const toneClass = {
    success: "border-emerald-200 bg-emerald-50 text-emerald-700",
    warning: "border-amber-200 bg-amber-50 text-amber-800",
    danger: "border-rose-200 bg-rose-50 text-rose-700",
    neutral: "border-slate-200 bg-slate-100 text-slate-700",
  } as const;

  const incidentState = diagnostics.incident
    ? {
        label: `${diagnostics.incident.severity} ${titleCase(diagnostics.incident.state)}`,
        className: "border-rose-200 bg-rose-50 text-rose-700",
        summary: `Incident ${diagnostics.incident.id} is ${titleCase(diagnostics.incident.state)} with ${diagnostics.alerts.openCount} open alerts on this node.`,
      }
    : payload.sync.isStale || diagnostics.lastFailedJob || payload.sync.pendingActionCount > 0
      ? {
          label: "Watchlist",
          className: "border-amber-200 bg-amber-50 text-amber-800",
          summary: payload.sync.pendingActionCount > 0
            ? `${payload.sync.pendingActionCount} VPS action ${payload.sync.pendingActionCount === 1 ? "is" : "are"} still in progress.`
            : diagnostics.lastFailedJob
              ? `The last ${titleCase(diagnostics.lastFailedJob.type)} job failed and should be reviewed before retrying.`
              : "Control-plane freshness or lifecycle status still needs operator review.",
        }
      : {
          label: "Clear",
          className: "border-emerald-200 bg-emerald-50 text-emerald-700",
          summary: "No active incident or unresolved lifecycle blocker is currently recorded on this server.",
        };

  const guidance = [
    payload.sync.isStale ? "Run a manual sync before treating this server state as authoritative." : null,
    diagnostics.incident ? `Keep incident ${diagnostics.incident.id} active until response and mitigation deadlines are satisfied.` : null,
    diagnostics.lastFailedJob ? `Review the failed ${titleCase(diagnostics.lastFailedJob.type)} job before retrying automation.` : null,
    !payload.backups.enabled ? "Enable managed backups or validate snapshot policy for recovery readiness." : null,
    !payload.server.firewallEnabled ? "Apply a firewall profile before exposing this node to broader access paths." : null,
    !payload.server.monitoringEnabled ? "Restore monitoring coverage so telemetry remains authoritative during incidents." : null,
  ].filter(Boolean).slice(0, 4) as string[];

  return (
    <div className="space-y-4 pb-6">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => (
          <article key={card.label} className="rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{card.label}</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{card.value}</p>
              </div>
              <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${toneClass[card.tone]}`}>
                {card.tone}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-500">{card.helper}</p>
          </article>
        ))}
      </section>

      <div className="grid grid-cols-12 gap-4 xl:items-start">
        <section className="col-span-12 rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_18px_42px_rgba(15,23,42,0.06)] xl:col-span-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Operating overview</p>
              <h2 className="mt-1 text-[32px] font-semibold tracking-tight text-slate-950">Server Posture</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Real-time operating context for compute state, network identity, protection posture, and commercial support around this individual VPS.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/app/vps/${payload.server.id}/networking`} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-50">
                Networking
              </Link>
              <Link href={`/app/vps/${payload.server.id}/support`} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-50">
                Support
              </Link>
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <article className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Compute capacity</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{payload.server.plan.vcpu} vCPU · {payload.server.plan.memoryGb} GB RAM · {payload.server.plan.diskGb} GB NVMe</p>
              <p className="mt-2 text-sm text-slate-600">Status {payload.server.status} · Power {payload.server.powerState} · {payload.server.bandwidthUsedGb} GB of bandwidth consumed.</p>
              <p className="mt-2 text-xs text-slate-500">Created {formatDate(payload.server.createdAt)} · Uptime surface is available through monitoring.</p>
            </article>

            <article className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Network identity</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{payload.server.publicIpv4}</p>
              <p className="mt-2 text-sm text-slate-600">SSH {payload.server.sshEndpoint}{payload.server.privateIpv4 ? ` · Private ${payload.server.privateIpv4}` : " · No private interface attached"}</p>
              <p className="mt-2 text-xs text-slate-500">rDNS {payload.server.reverseDns || "not configured"} · {payload.server.datacenterLabel || payload.server.region}</p>
            </article>

            <article className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Protection and recovery</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{payload.backups.enabled ? payload.backups.frequency || "Backups active" : "Managed backups disabled"}</p>
              <p className="mt-2 text-sm text-slate-600">{payload.snapshots.count} snapshots recorded · Firewall {payload.server.firewallEnabled ? payload.server.firewallProfileName || "enabled" : "disabled"}</p>
              <p className="mt-2 text-xs text-slate-500">Last successful backup {formatDateTime(payload.backups.lastSuccessAt)} · Rescue mode {payload.server.rescueEnabled ? "enabled" : "disabled"}</p>
            </article>

            <article className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Commercial and support</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{formatMoney(payload.server.billing.monthlyPriceCents, payload.server.billing.currency)}/mo</p>
              <p className="mt-2 text-sm text-slate-600">Renews {formatDate(payload.server.billing.renewalAt)} · {payload.server.support.tier} support tier</p>
              <p className="mt-2 text-xs text-slate-500">{payload.server.support.openTicketCount} open tickets · Next invoice {formatDate(payload.server.billing.nextInvoiceAt)}</p>
            </article>
          </div>
        </section>

        <aside className="col-span-12 space-y-4 xl:col-span-4">
          <section className="rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-[0_16px_36px_rgba(15,23,42,0.06)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Incident desk</p>
                <h3 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">Escalation State</h3>
              </div>
              <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${incidentState.className}`}>
                {incidentState.label}
              </span>
            </div>

            <p className="mt-3 text-sm leading-6 text-slate-600">{incidentState.summary}</p>

            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                <span className="text-slate-600">Open alerts</span>
                <span className={`font-semibold ${diagnostics.alerts.openCount > 0 ? "text-amber-700" : "text-slate-950"}`}>{diagnostics.alerts.openCount}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                <span className="text-slate-600">SLA clock</span>
                <span className={`font-semibold ${diagnostics.sla?.state === "BREACHED" ? "text-rose-700" : diagnostics.sla?.state === "AT_RISK" ? "text-amber-700" : "text-slate-950"}`}>{diagnostics.sla?.state || "No active SLA"}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                <span className="text-slate-600">Pending actions</span>
                <span className={`font-semibold ${payload.sync.pendingActionCount > 0 ? "text-sky-700" : "text-slate-950"}`}>{payload.sync.pendingActionCount}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                <span className="text-slate-600">Last failed job</span>
                <span className={`font-semibold ${diagnostics.lastFailedJob ? "text-rose-700" : "text-slate-950"}`}>{diagnostics.lastFailedJob ? titleCase(diagnostics.lastFailedJob.type) : "Clear"}</span>
              </div>
            </div>

            <p className="mt-3 text-xs text-slate-500">
              {diagnostics.lastFailedJob?.finishedAt
                ? `Last failure ${formatDateTime(diagnostics.lastFailedJob.finishedAt)}${diagnostics.lastFailedJob.error ? ` · ${diagnostics.lastFailedJob.error}` : ""}`
                : `Provider health ${titleCase(diagnostics.provider.health)} · last checked ${formatDateTime(diagnostics.provider.lastCheckedAt)}`}
            </p>
          </section>

          <section className="rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-[0_16px_36px_rgba(15,23,42,0.06)]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Operator guidance</p>
            <h3 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">Next Best Actions</h3>
            <div className="mt-4 space-y-3 text-sm text-slate-700">
              {guidance.length ? guidance.map((item) => (
                <div key={item} className="flex items-start gap-3">
                  <span className="mt-1 h-4 w-4 rounded-full border border-slate-300 bg-slate-50 text-center text-[10px] leading-[14px] text-slate-500">✓</span>
                  <p>{item}</p>
                </div>
              )) : <p className="text-sm text-slate-600">This server currently has no immediate remediation recommendation from the persisted control-plane state.</p>}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Link href={`/app/vps/${payload.server.id}/console`} className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-50">
                Console
              </Link>
              <Link href={`/app/vps/${payload.server.id}/backups`} className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-50">
                Recovery
              </Link>
              <Link href={`/app/vps/${payload.server.id}/activity`} className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-50">
                Activity
              </Link>
              <Link href={`/app/vps/${payload.server.id}/support`} className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-50">
                Support
              </Link>
            </div>
          </section>
        </aside>
      </div>

      <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_16px_36px_rgba(15,23,42,0.05)]">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Telemetry</p>
            <h2 className="mt-1 text-[32px] font-semibold tracking-tight text-slate-950">Live Resource Strip</h2>
          </div>
        </div>
        <VpsMonitoringStrip payload={payload} />
      </section>

      <div className="grid grid-cols-12 gap-4 xl:items-start">
        <section className="col-span-12 rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_16px_36px_rgba(15,23,42,0.05)] xl:col-span-7">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Alert queue</p>
              <h2 className="mt-1 text-[32px] font-semibold tracking-tight text-slate-950">Current Alerts</h2>
            </div>
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${diagnostics.alerts.criticalCount > 0 ? toneClass.danger : diagnostics.alerts.openCount > 0 ? toneClass.warning : toneClass.success}`}>
              {diagnostics.alerts.openCount} open
            </span>
          </div>
          <VpsAlertQueue
            serverId={serverId}
            initialAlerts={diagnostics.alerts.items as VpsAlertEventView[]}
            canManage={false}
            emptyMessage="No actionable VPS alerts are currently open for this server."
          />
        </section>

        <section className="col-span-12 rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_16px_36px_rgba(15,23,42,0.05)] xl:col-span-5">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Activity log</p>
              <h2 className="mt-1 text-[32px] font-semibold tracking-tight text-slate-950">Recent Activity</h2>
            </div>
            <Link href={`/app/vps/${payload.server.id}/activity`} className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 hover:text-slate-900">
              Open timeline
            </Link>
          </div>
          <VpsActivityTimeline items={payload.activity} />
        </section>
      </div>

      <div className="grid grid-cols-12 gap-4 xl:items-start">
        <section className="col-span-12 rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_16px_36px_rgba(15,23,42,0.05)] xl:col-span-6">
          <div className="mb-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Identity and access</p>
            <h2 className="mt-1 text-[28px] font-semibold tracking-tight text-slate-950">Access Surface</h2>
          </div>
          <VpsDetailGrid
            items={[
              { label: "Instance ID", value: payload.server.instanceId },
              { label: "Provider ID", value: payload.server.providerServerId || "Not bound" },
              { label: "Public IPv4", value: payload.server.publicIpv4 },
              { label: "Private IP", value: payload.server.privateIpv4 || "Not attached" },
              { label: "SSH endpoint", value: payload.server.sshEndpoint },
              { label: "Reverse DNS", value: payload.server.reverseDns || "Not configured" },
              { label: "OS image", value: `${payload.server.osName} (${payload.server.imageSlug})` },
              { label: "Virtualization", value: payload.server.virtualizationType || "Provider managed" },
            ]}
          />
        </section>

        <section className="col-span-12 rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_16px_36px_rgba(15,23,42,0.05)] xl:col-span-6">
          <div className="mb-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Recovery and support</p>
            <h2 className="mt-1 text-[28px] font-semibold tracking-tight text-slate-950">Safety Envelope</h2>
          </div>
          <VpsDetailGrid
            items={[
              { label: "Firewall", value: payload.server.firewallEnabled ? payload.server.firewallProfileName || "Enabled" : "Disabled" },
              { label: "Backups", value: payload.backups.enabled ? payload.backups.frequency || "Enabled" : "Disabled" },
              { label: "Snapshots", value: `${payload.snapshots.count} total` },
              { label: "Monitoring", value: payload.server.monitoringStatus || (payload.server.monitoringEnabled ? "Enabled" : "Disabled") },
              { label: "Last backup", value: formatDateTime(payload.backups.lastSuccessAt) },
              { label: "Next backup", value: formatDateTime(payload.backups.nextRunAt) },
              { label: "Support tier", value: payload.server.support.tier },
              { label: "Open tickets", value: String(payload.server.support.openTicketCount) },
              { label: "Renewal", value: formatDate(payload.server.billing.renewalAt) },
              { label: "Monthly spend", value: formatMoney(payload.server.billing.monthlyPriceCents, payload.server.billing.currency) },
            ]}
          />
        </section>
      </div>
    </div>
  );
}
