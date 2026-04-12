import { notFound } from "next/navigation";
import { VpsAlertQueue } from "@/components/app/vps-alert-queue";
import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { getVpsDashboardPayload } from "@/lib/vps/data";
import { VpsActivityTimeline, VpsDetailGrid, VpsMonitoringStrip, VpsSectionCard, VpsWorkspaceModuleGrid, VpsWorkspaceSectionHeader } from "@/components/app/vps-ui";

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

  return (
    <div className="space-y-6">
      <VpsWorkspaceSectionHeader
        eyebrow="Overview"
        title="Service posture"
        description="Primary infrastructure posture for this server across compute state, network identity, recovery readiness, and operational support."
        meta={`${payload.server.region} · ${payload.server.osName}`}
      />

      <VpsWorkspaceModuleGrid
        modules={[
          {
            title: "Compute state",
            status: payload.server.status === "RUNNING" ? "ACTIVE" : payload.server.status === "STOPPED" ? "ATTENTION" : "READY",
            description: `${payload.server.plan.vcpu} vCPU, ${payload.server.plan.memoryGb} GB RAM, ${payload.server.plan.diskGb} GB NVMe, and ${payload.server.plan.bandwidthTb} TB bandwidth are attached to this node.`,
            detail: `Power ${payload.server.powerState}`,
            href: `/app/vps/${payload.server.id}`,
            actionLabel: "Review overview",
          },
          {
            title: "Network identity",
            status: payload.server.publicIpv4 ? "ACTIVE" : "PENDING",
            description: `Public endpoint ${payload.server.publicIpv4} with ${payload.server.privateIpv4 ? `private address ${payload.server.privateIpv4}` : "no private interface currently attached"}.`,
            detail: payload.server.reverseDns || "Reverse DNS not set",
            href: `/app/vps/${payload.server.id}/networking`,
            actionLabel: "Open networking",
          },
          {
            title: "Recovery path",
            status: payload.backups.enabled || payload.snapshots.count > 0 ? "ACTIVE" : "ATTENTION",
            description: `${payload.backups.enabled ? "Managed backups are active" : "Managed backups are not active"} and ${payload.snapshots.count} snapshots are recorded for this server.`,
            detail: payload.backups.lastSuccessAt ? `Last backup ${new Date(payload.backups.lastSuccessAt).toLocaleDateString()}` : "No successful backup yet",
            href: `/app/vps/${payload.server.id}/backups`,
            actionLabel: "Open recovery",
          },
          {
            title: "Operations",
            status: diagnostics.incident || diagnostics.lastFailedJob || payload.sync.pendingActionCount > 0 ? "ATTENTION" : "ACTIVE",
            description: diagnostics.incident
              ? `Incident ${diagnostics.incident.id} is ${diagnostics.incident.state.toLowerCase()} with ${diagnostics.alerts.openCount} open alerts linked to this server.`
              : `${payload.server.support.openTicketCount} open tickets and ${payload.sync.pendingActionCount} queued actions are currently associated with this server.`,
            detail: diagnostics.sla ? `${diagnostics.sla.state} SLA` : payload.server.support.tier,
            href: `/app/vps/${payload.server.id}/support`,
            actionLabel: "Open support",
          },
        ]}
      />

      <VpsMonitoringStrip payload={payload} />

      <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <VpsSectionCard title="Quick details" description="Identity, access, and infrastructure state at a glance.">
          <VpsDetailGrid
            items={[
              { label: "Instance ID", value: payload.server.instanceId },
              { label: "Provider ID", value: payload.server.providerServerId || "Not bound" },
              { label: "Public IPv4", value: payload.server.publicIpv4 },
              { label: "Private IP", value: payload.server.privateIpv4 || "Not attached" },
              { label: "SSH endpoint", value: payload.server.sshEndpoint },
              { label: "Datacenter region", value: payload.server.datacenterLabel || payload.server.region },
              { label: "OS image", value: `${payload.server.osName} (${payload.server.imageSlug})` },
              { label: "Created date", value: new Date(payload.server.createdAt).toLocaleDateString() },
              { label: "Last sync", value: diagnostics.server.lastSyncedAt ? new Date(diagnostics.server.lastSyncedAt).toLocaleString() : "Never synced" },
              { label: "Virtualization", value: payload.server.virtualizationType || "Provider managed" },
            ]}
          />
        </VpsSectionCard>

        <VpsSectionCard title="Safety and protection" description="Backup, firewall, monitoring, and support posture.">
          <VpsDetailGrid
            items={[
              { label: "Firewall", value: payload.server.firewallEnabled ? payload.server.firewallProfileName || "Enabled" : "Disabled" },
              { label: "Backups", value: payload.backups.enabled ? payload.backups.frequency || "Enabled" : "Disabled" },
              { label: "Snapshots", value: `${payload.snapshots.count} total` },
              { label: "Monitoring", value: payload.server.monitoringStatus || (payload.server.monitoringEnabled ? "Enabled" : "Disabled") },
              { label: "Last backup", value: payload.backups.lastSuccessAt ? new Date(payload.backups.lastSuccessAt).toLocaleString() : "No successful backup yet" },
              { label: "Support tier", value: payload.server.support.tier },
              { label: "Open tickets", value: String(payload.server.support.openTicketCount) },
              { label: "Open alerts", value: String(diagnostics.alerts.openCount) },
              { label: "Incident", value: diagnostics.incident ? `${diagnostics.incident.severity} · ${diagnostics.incident.state}` : "None" },
              { label: "rDNS", value: payload.server.reverseDnsStatus || "Pending" },
              { label: "Bandwidth", value: `${payload.server.bandwidthUsedGb} GB used` },
            ]}
          />
        </VpsSectionCard>
      </div>

      <VpsSectionCard title="Current alerts" description="Persisted VPS alert queue derived from provider health, drift, and recent job outcomes.">
        <VpsAlertQueue
          serverId={serverId}
          initialAlerts={diagnostics.alerts.items}
          canManage={false}
          emptyMessage="No actionable VPS alerts are currently open for this server."
        />
      </VpsSectionCard>

      <VpsSectionCard title="Recent activity" description="Operational history and audit-linked changes for this VPS.">
        <VpsActivityTimeline items={payload.activity} />
      </VpsSectionCard>
    </div>
  );
}
