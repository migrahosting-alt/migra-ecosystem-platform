import Link from "next/link";
import { notFound } from "next/navigation";
import { VpsAlertQueue } from "@/components/app/vps-alert-queue";
import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { VpsSupportActions } from "@/components/app/vps-support-actions";
import { getVpsCapabilities } from "@/lib/vps/access";
import { resolveActorRole } from "@/lib/vps/authz";
import { getVpsSupportState } from "@/lib/vps/data";
import { getVpsFeatureFlags } from "@/lib/vps/features";
import { VpsDetailGrid, VpsSectionCard, VpsWorkspaceModuleGrid, VpsWorkspaceSectionHeader } from "@/components/app/vps-ui";

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

  return (
    <div className="space-y-6">
      <VpsWorkspaceSectionHeader
        eyebrow="Support"
        title="Operational support desk"
        description="Server-scoped diagnostics, linked tickets, and escalation controls for enterprise incident handling and client communications."
        meta={`${support.tickets.length} linked tickets`}
      />

      <VpsWorkspaceModuleGrid
        modules={[
          {
            title: "Support contract",
            status: "ACTIVE",
            description: `${support.server.supportTier || "STANDARD"} support is attached to this server with workspace-aware diagnostic context available for escalations.`,
            detail: support.server.supportTicketUrl ? "Portal linked" : "Standard operations workflow",
          },
          {
            title: "Diagnostic bundle",
            status: features.supportDiagnostics ? "ACTIVE" : "PENDING",
            description: features.supportDiagnostics
              ? "Support diagnostics now come from the authoritative server diagnostics resolver instead of a page-specific bundle."
              : "Diagnostic export is disabled in the current feature flag set.",
            detail: diagnostics.server.lastSyncedAt ? `Last sync ${new Date(diagnostics.server.lastSyncedAt).toLocaleString()}` : "Never synced",
          },
          {
            title: "Recovery context",
            status: support.diagnosticsSummary.latestSnapshot || support.diagnosticsSummary.lastBackupAt ? "ACTIVE" : "ATTENTION",
            description: support.diagnosticsSummary.latestSnapshot || support.diagnosticsSummary.lastBackupAt
              ? "Support has current recovery context through backup and snapshot visibility when investigating incidents."
              : "Recovery context is limited because recent backup or snapshot evidence is not present in the current support bundle.",
            detail: support.diagnosticsSummary.backupStatus,
          },
          {
            title: "Incident queue",
            status: diagnostics.incident ? "ATTENTION" : support.tickets.length > 0 ? "ATTENTION" : "READY",
            description: diagnostics.incident
              ? `Incident ${diagnostics.incident.id} is ${diagnostics.incident.state.toLowerCase()} with ${diagnostics.alerts.openCount} open alerts linked to this server.`
              : support.tickets.length > 0
                ? `${support.tickets.length} server-linked tickets are currently active in the workspace.`
                : "No linked tickets or active incidents are open right now.",
            detail: `${support.diagnosticsSummary.recentActionCount} recent action jobs`,
          },
          {
            title: "Provider diagnostics",
            status: diagnostics.provider.health === "HEALTHY" ? "ACTIVE" : diagnostics.provider.health === "DEGRADED" ? "ATTENTION" : "PENDING",
            description: diagnostics.provider.error
              ? diagnostics.provider.error
              : "Persisted provider health, drift, and recent failures are visible here for support without checking host logs.",
            detail: diagnostics.drift.type || "No drift recorded",
          },
        ]}
      />

      <VpsSectionCard title="Support header" description="Tier, SLA path, and server-aware diagnostic sharing.">
        <VpsDetailGrid
          items={[
            { label: "Support tier", value: support.server.supportTier || "STANDARD" },
            { label: "Ticket link", value: support.server.supportTicketUrl || "Managed through MigraHosting operations" },
            { label: "Docs", value: support.server.supportDocsUrl || "Use the VPS workspace diagnostics and standard runbooks" },
            { label: "Last sync", value: diagnostics.server.lastSyncedAt ? new Date(diagnostics.server.lastSyncedAt).toLocaleString() : "Never" },
            { label: "Provider health", value: diagnostics.provider.health },
            { label: "Drift", value: diagnostics.drift.type || "None detected" },
            { label: "Open alerts", value: String(diagnostics.alerts.openCount) },
            { label: "Critical alerts", value: String(diagnostics.alerts.criticalCount) },
            { label: "Alert queue", value: String(support.alerts.length) },
            { label: "Current incident", value: diagnostics.incident ? `${diagnostics.incident.severity} · ${diagnostics.incident.state}` : "None" },
            { label: "SLA state", value: diagnostics.sla ? diagnostics.sla.state : "No active SLA clock" },
            { label: "Diagnostics contract", value: "Persisted server, provider, drift, alerts, incident, jobs, remediation, and SLA" },
          ]}
        />
      </VpsSectionCard>

      <VpsSectionCard title="Alert queue" description="Persisted VPS alerts with incident linkage and support-side lifecycle controls.">
        <VpsAlertQueue
          serverId={serverId}
          initialAlerts={support.alerts}
          canManage={capabilities.canOpenSupport}
          emptyMessage="No active or acknowledged VPS alerts are currently attached to this server."
        />
      </VpsSectionCard>

      <VpsSectionCard title="Support actions" description="Open the support portal, export a diagnostics bundle, or create a server-linked support request without leaving the VPS workspace.">
        <VpsSupportActions
          serverId={serverId}
          canOpenSupport={capabilities.canOpenSupport}
          diagnosticsEnabled={features.supportDiagnostics}
          supportPortalUrl={support.server.supportTicketUrl}
        />
      </VpsSectionCard>

      <VpsSectionCard title="Linked tickets" description="Server-scoped support records currently attached to this VPS.">
        {!support.tickets.length ? (
          <p className="text-sm text-[var(--ink-muted)]">No support links are attached to this server yet.</p>
        ) : (
          <div className="space-y-3">
            {support.tickets.map((ticket) => (
              <div key={ticket.id} className="rounded-xl border border-[var(--line)] px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-[var(--ink)]">{ticket.title || ticket.externalTicketId || "Support ticket"}</p>
                  <span className="text-xs text-[var(--ink-muted)]">{(ticket.lastUpdatedAt || ticket.updatedAt).toLocaleString()}</span>
                </div>
                <p className="mt-1 text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                  {ticket.status} · {ticket.priority || "normal"}{ticket.category ? ` · ${ticket.category}` : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </VpsSectionCard>

      <VpsSectionCard title="Diagnostic context" description="Real server context that support engineers need before taking action.">
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
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <div className="rounded-xl border border-[var(--line)] px-4 py-3 text-sm">
            <p className="font-semibold text-[var(--ink)]">Diagnostics Summary</p>
            <p className="mt-2 text-[var(--ink-muted)]">Provider health: {diagnostics.provider.health}</p>
            <p className="mt-1 text-[var(--ink-muted)]">Drift: {diagnostics.drift.detected ? diagnostics.drift.type || "Detected" : "None"}</p>
            <p className="mt-1 text-[var(--ink-muted)]">Last sync: {diagnostics.server.lastSyncedAt ? new Date(diagnostics.server.lastSyncedAt).toLocaleString() : "Never"}</p>
          </div>
          <div className="rounded-xl border border-[var(--line)] px-4 py-3 text-sm">
            <p className="font-semibold text-[var(--ink)]">Incident</p>
            <p className="mt-2 text-[var(--ink-muted)]">{diagnostics.incident ? `${diagnostics.incident.severity} incident ${diagnostics.incident.id} is ${diagnostics.incident.state.toLowerCase()}.` : "No active incident linked to this server."}</p>
            <p className="mt-1 text-[var(--ink-muted)]">SLA: {diagnostics.sla ? diagnostics.sla.state : "No active SLA clock"}</p>
          </div>
          <div className="rounded-xl border border-[var(--line)] px-4 py-3 text-sm">
            <p className="font-semibold text-[var(--ink)]">Failures</p>
            <p className="mt-2 text-[var(--ink-muted)]">{diagnostics.lastFailedJob ? `${diagnostics.lastFailedJob.type} failed${diagnostics.lastFailedJob.error ? `: ${diagnostics.lastFailedJob.error}` : ""}` : "No failed jobs are currently recorded."}</p>
            <p className="mt-1 text-[var(--ink-muted)]">Last failed at: {diagnostics.lastFailedJob?.finishedAt ? new Date(diagnostics.lastFailedJob.finishedAt).toLocaleString() : "N/A"}</p>
          </div>
          <div className="rounded-xl border border-[var(--line)] px-4 py-3 text-sm">
            <p className="font-semibold text-[var(--ink)]">Recommended actions</p>
            <div className="mt-2 space-y-2 text-[var(--ink-muted)]">
              {support.recommendedActions.map((action) => (
                <p key={action}>{action}</p>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          {support.server.supportTicketUrl ? (
            <Link
              href={support.server.supportTicketUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-xl border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-2)]"
            >
              Open Support Portal
            </Link>
          ) : null}
          {support.server.supportDocsUrl ? (
            <Link
              href={support.server.supportDocsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-xl border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-2)]"
            >
              Troubleshooting Docs
            </Link>
          ) : null}
        </div>
      </VpsSectionCard>
    </div>
  );
}
