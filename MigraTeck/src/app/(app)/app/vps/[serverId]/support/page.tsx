import Link from "next/link";
import { notFound } from "next/navigation";
import { VpsAlertQueue } from "@/components/app/vps-alert-queue";
import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { VpsSupportActions } from "@/components/app/vps-support-actions";
import { getVpsCapabilities } from "@/lib/vps/access";
import { resolveActorRole } from "@/lib/vps/authz";
import { getVpsSupportState } from "@/lib/vps/data";
import { getVpsFeatureFlags } from "@/lib/vps/features";
import { VpsDetailGrid } from "@/components/app/vps-ui";

export default async function VpsSupportPage({ params }: { params: Promise<{ serverId: string }> }) {
  const { serverId } = await params;
  const session = await requireAuthSession();
  const membership = await getActiveOrgContext(session.user.id);

  if (!membership) {
    notFound();
  }

  const support = await getVpsSupportState(serverId, membership.orgId);

  if (!support) {
    notFound();
  }

  const resolvedRole = await resolveActorRole({
    userId: session.user.id,
    orgId: membership.orgId,
    role: membership.role,
  }, serverId);
  const capabilities = getVpsCapabilities(resolvedRole.role);
  if (!capabilities.canOpenSupport) {
    notFound();
  }
  const features = getVpsFeatureFlags();
  const diagnostics = support.diagnostics;

  if (!diagnostics) {
    notFound();
  }

  const contractLabel = support.server.supportTier || "STANDARD";
  const incidentLabel = diagnostics.incident ? `${diagnostics.incident.severity} · ${diagnostics.incident.state}` : "No active incident";
  const providerTone = diagnostics.provider.health === "HEALTHY"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : diagnostics.provider.health === "DEGRADED"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-slate-200 bg-slate-100 text-slate-700";

  return (
    <div className="space-y-4 pb-6">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Support contract</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{contractLabel}</p>
          <p className="mt-3 text-sm leading-6 text-slate-500">{support.server.supportTicketUrl ? "Portal-linked support path is available for direct escalation." : "Standard MigraHosting operations workflow is attached to this server."}</p>
        </article>
        <article className="rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Linked tickets</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{support.tickets.length}</p>
          <p className="mt-3 text-sm leading-6 text-slate-500">Active support records currently attached to this server scope.</p>
        </article>
        <article className="rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Open alerts</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{diagnostics.alerts.openCount}</p>
          <p className="mt-3 text-sm leading-6 text-slate-500">{diagnostics.alerts.criticalCount} critical alerts currently influencing support posture.</p>
        </article>
        <article className="rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Incident state</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{diagnostics.incident ? diagnostics.incident.state : "Clear"}</p>
          <p className="mt-3 text-sm leading-6 text-slate-500">{diagnostics.incident ? `Incident ${diagnostics.incident.id} is active in the escalation path.` : "No active incident is currently linked to this server."}</p>
        </article>
      </section>

      <div className="grid grid-cols-12 gap-4 xl:items-start">
        <section className="col-span-12 rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_18px_42px_rgba(15,23,42,0.06)] xl:col-span-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Support desk</p>
              <h2 className="mt-1 text-[32px] font-semibold tracking-tight text-slate-950">Operational Escalation Surface</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Server-scoped diagnostics, open alerts, and support handoff controls aligned for enterprise incident response and client communication.
              </p>
            </div>
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${providerTone}`}>
              {diagnostics.provider.health}
            </span>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <article className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Diagnostic contract</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{features.supportDiagnostics ? "Authoritative diagnostics enabled" : "Diagnostics export limited"}</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {features.supportDiagnostics
                  ? "Support sees persisted server, provider, drift, incident, alert, remediation, and SLA state without leaving the VPS workspace."
                  : "Diagnostic export is disabled by feature flag, so support handoff depends on the reduced workspace state only."}
              </p>
            </article>
            <article className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Recovery context</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{support.diagnosticsSummary.backupStatus}</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {support.diagnosticsSummary.latestSnapshot || support.diagnosticsSummary.lastBackupAt
                  ? "Backup and snapshot evidence is present for recovery planning during escalation."
                  : "Recent backup or snapshot evidence is missing, which weakens recovery context for support decisions."}
              </p>
            </article>
            <article className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Incident queue</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{incidentLabel}</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {diagnostics.incident
                  ? `${diagnostics.alerts.openCount} open alerts and ${support.diagnosticsSummary.recentActionCount} recent action jobs are attached to the current escalation trail.`
                  : support.tickets.length > 0
                    ? `${support.tickets.length} linked tickets remain active even without an incident clock.`
                    : "No open linked tickets or active incidents are currently present."}
              </p>
            </article>
            <article className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Provider diagnostics</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{diagnostics.drift.type || "No drift recorded"}</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {diagnostics.provider.error || "Persisted provider health, drift, and failure context are available to support without checking host logs."}
              </p>
            </article>
          </div>
        </section>

        <aside className="col-span-12 space-y-4 xl:col-span-4">
          <section className="rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-[0_16px_36px_rgba(15,23,42,0.06)]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Escalation posture</p>
            <h3 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">Operator Guidance</h3>
            <div className="mt-4 space-y-3 text-sm text-slate-700">
              {support.recommendedActions.map((action) => (
                <div key={action} className="flex items-start gap-3">
                  <span className="mt-1 h-4 w-4 rounded-full border border-slate-300 bg-slate-50 text-center text-[10px] leading-[14px] text-slate-500">✓</span>
                  <p>{action}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-[0_16px_36px_rgba(15,23,42,0.06)]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Quick facts</p>
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                <span className="text-slate-600">SLA state</span>
                <span className="font-semibold text-slate-950">{diagnostics.sla ? diagnostics.sla.state : "No active clock"}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                <span className="text-slate-600">Recent actions</span>
                <span className="font-semibold text-slate-950">{support.diagnosticsSummary.recentActionCount}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                <span className="text-slate-600">Recent audit events</span>
                <span className="font-semibold text-slate-950">{support.diagnosticsSummary.recentAuditCount}</span>
              </div>
            </div>
          </section>
        </aside>
      </div>

      <div className="grid grid-cols-12 gap-4 xl:items-start">
        <section className="col-span-12 rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_16px_36px_rgba(15,23,42,0.05)] xl:col-span-7">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Active alert queue</p>
              <h2 className="mt-1 text-[28px] font-semibold tracking-tight text-slate-950">Incident-Linked Alerts</h2>
            </div>
          </div>
          <VpsAlertQueue
            serverId={serverId}
            initialAlerts={support.alerts}
            canManage={capabilities.canOpenSupport}
            emptyMessage="No active or acknowledged VPS alerts are currently attached to this server."
          />
        </section>

        <section className="col-span-12 rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_16px_36px_rgba(15,23,42,0.05)] xl:col-span-5">
          <div className="mb-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Support actions</p>
            <h2 className="mt-1 text-[28px] font-semibold tracking-tight text-slate-950">Handoff And Export</h2>
          </div>
          <VpsSupportActions
            serverId={serverId}
            canOpenSupport={capabilities.canOpenSupport}
            diagnosticsEnabled={features.supportDiagnostics}
            supportPortalUrl={support.server.supportTicketUrl}
          />
        </section>
      </div>

      <div className="grid grid-cols-12 gap-4 xl:items-start">
        <section className="col-span-12 rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_16px_36px_rgba(15,23,42,0.05)] xl:col-span-5">
          <div className="mb-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Support header</p>
            <h2 className="mt-1 text-[28px] font-semibold tracking-tight text-slate-950">Contract And SLA</h2>
          </div>
          <VpsDetailGrid
            items={[
              { label: "Support tier", value: contractLabel },
              { label: "Ticket link", value: support.server.supportTicketUrl || "Managed through MigraHosting operations" },
              { label: "Docs", value: support.server.supportDocsUrl || "Use the VPS workspace diagnostics and standard runbooks" },
              { label: "Last sync", value: diagnostics.server.lastSyncedAt ? new Date(diagnostics.server.lastSyncedAt).toLocaleString() : "Never" },
              { label: "Provider health", value: diagnostics.provider.health },
              { label: "Drift", value: diagnostics.drift.type || "None detected" },
              { label: "Open alerts", value: String(diagnostics.alerts.openCount) },
              { label: "Critical alerts", value: String(diagnostics.alerts.criticalCount) },
              { label: "Alert queue", value: String(support.alerts.length) },
              { label: "Current incident", value: incidentLabel },
              { label: "SLA state", value: diagnostics.sla ? diagnostics.sla.state : "No active SLA clock" },
              { label: "Diagnostics contract", value: "Persisted server, provider, drift, alerts, incident, jobs, remediation, and SLA" },
            ]}
          />
        </section>

        <section className="col-span-12 rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_16px_36px_rgba(15,23,42,0.05)] xl:col-span-7">
          <div className="mb-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Diagnostic context</p>
            <h2 className="mt-1 text-[28px] font-semibold tracking-tight text-slate-950">Support Runbook Inputs</h2>
          </div>
          <VpsDetailGrid
            items={[
              { label: "Recent action jobs", value: String(support.diagnosticsSummary.recentActionCount) },
              { label: "Recent audit events", value: String(support.diagnosticsSummary.recentAuditCount) },
              { label: "Recent alerts", value: String(support.diagnosticsSummary.recentAlertCount) },
              { label: "Firewall profile", value: `${support.diagnosticsSummary.firewallProfile} · ${support.diagnosticsSummary.firewallStatus}` },
              { label: "Backup status", value: support.diagnosticsSummary.backupStatus },
              { label: "Last backup", value: support.diagnosticsSummary.lastBackupAt ? new Date(support.diagnosticsSummary.lastBackupAt).toLocaleString() : "No successful backup yet" },
              { label: "Next backup", value: support.diagnosticsSummary.nextBackupAt ? new Date(support.diagnosticsSummary.nextBackupAt).toLocaleString() : "Not scheduled" },
              { label: "Latest snapshot", value: support.diagnosticsSummary.latestSnapshot ? `${support.diagnosticsSummary.latestSnapshot.name} · ${support.diagnosticsSummary.latestSnapshot.status}` : "None recorded" },
              { label: "Last job", value: diagnostics.lastJob ? `${diagnostics.lastJob.type} · ${diagnostics.lastJob.status}` : "No jobs recorded" },
              { label: "Last remediation", value: diagnostics.remediation.lastRun ? `${diagnostics.remediation.lastStatus || "UNKNOWN"} · ${new Date(diagnostics.remediation.lastRun).toLocaleString()}` : "No remediation runs recorded" },
            ]}
          />
          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm">
              <p className="font-semibold text-slate-950">Diagnostics summary</p>
              <p className="mt-2 text-slate-600">Provider health: {diagnostics.provider.health}</p>
              <p className="mt-1 text-slate-600">Drift: {diagnostics.drift.detected ? diagnostics.drift.type || "Detected" : "None"}</p>
              <p className="mt-1 text-slate-600">Last sync: {diagnostics.server.lastSyncedAt ? new Date(diagnostics.server.lastSyncedAt).toLocaleString() : "Never"}</p>
            </div>
            <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm">
              <p className="font-semibold text-slate-950">Incident</p>
              <p className="mt-2 text-slate-600">{diagnostics.incident ? `${diagnostics.incident.severity} incident ${diagnostics.incident.id} is ${diagnostics.incident.state.toLowerCase()}.` : "No active incident linked to this server."}</p>
              <p className="mt-1 text-slate-600">SLA: {diagnostics.sla ? diagnostics.sla.state : "No active SLA clock"}</p>
            </div>
            <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm">
              <p className="font-semibold text-slate-950">Failures</p>
              <p className="mt-2 text-slate-600">{diagnostics.lastFailedJob ? `${diagnostics.lastFailedJob.type} failed${diagnostics.lastFailedJob.error ? `: ${diagnostics.lastFailedJob.error}` : ""}` : "No failed jobs are currently recorded."}</p>
              <p className="mt-1 text-slate-600">Last failed at: {diagnostics.lastFailedJob?.finishedAt ? new Date(diagnostics.lastFailedJob.finishedAt).toLocaleString() : "N/A"}</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            {support.server.supportTicketUrl ? (
              <Link
                href={support.server.supportTicketUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-50"
              >
                Open Support Portal
              </Link>
            ) : null}
            {support.server.supportDocsUrl ? (
              <Link
                href={support.server.supportDocsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-50"
              >
                Troubleshooting Docs
              </Link>
            ) : null}
          </div>
        </section>
      </div>

      <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_16px_36px_rgba(15,23,42,0.05)]">
        <div className="mb-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Linked tickets</p>
          <h2 className="mt-1 text-[28px] font-semibold tracking-tight text-slate-950">Server Support Records</h2>
        </div>
        {!support.tickets.length ? (
          <p className="text-sm text-slate-600">No support links are attached to this server yet.</p>
        ) : (
          <div className="space-y-3">
            {support.tickets.map((ticket) => (
              <div key={ticket.id} className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-slate-950">{ticket.title || ticket.externalTicketId || "Support ticket"}</p>
                  <span className="text-xs text-slate-500">{(ticket.lastUpdatedAt || ticket.updatedAt).toLocaleString()}</span>
                </div>
                <p className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-500">
                  {ticket.status} · {ticket.priority || "normal"}{ticket.category ? ` · ${ticket.category}` : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
