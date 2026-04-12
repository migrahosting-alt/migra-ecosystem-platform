import { notFound } from "next/navigation";
import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { getVpsDashboardPayload, getVpsMonitoringState } from "@/lib/vps/data";
import { VpsDetailGrid, VpsMetricCard, VpsSectionCard, VpsWorkspaceModuleGrid, VpsWorkspaceSectionHeader } from "@/components/app/vps-ui";

function formatUptime(seconds: number) {
  if (!seconds) {
    return "Fresh";
  }

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }

  return `${hours}h ${minutes}m`;
}

export default async function VpsMonitoringPage({ params }: { params: Promise<{ serverId: string }> }) {
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

  if (!payload.features.monitoring) {
    return (
      <VpsSectionCard title="Monitoring unavailable" description="This provider binding does not expose managed metric rollups through the VPS portal.">
        <p className="text-sm text-[var(--ink-muted)]">
          Live monitoring is intentionally disabled for {payload.server.providerSlug}. Cached VPS metadata remains available elsewhere in the workspace, but metric-driven charts and monitoring APIs stay blocked until the provider exposes a supported telemetry contract.
        </p>
      </VpsSectionCard>
    );
  }

  const monitoring = await getVpsMonitoringState(serverId, membership.orgId);

  if (!monitoring) {
    notFound();
  }

  const latest = monitoring.metrics[monitoring.metrics.length - 1];

  return (
    <div className="space-y-6">
      <VpsWorkspaceSectionHeader
        eyebrow="Monitoring"
        title="Telemetry and operating signals"
        description="Live cached rollups, monitoring posture, and sample health for this server's compute and network footprint."
        meta={monitoring.lastSyncedAt ? `Last sync ${new Date(monitoring.lastSyncedAt).toLocaleString()}` : "No monitoring sync yet"}
      />

      <VpsWorkspaceModuleGrid
        modules={[
          {
            title: "Telemetry state",
            status: monitoring.enabled ? monitoring.status === "HEALTHY" ? "ACTIVE" : "ATTENTION" : "PENDING",
            description: monitoring.enabled
              ? `Monitoring is enabled with ${monitoring.metrics.length} cached provider rollups currently available in the workspace.`
              : "Monitoring is not enabled for this server, so no live telemetry is being surfaced into the portal.",
            detail: monitoring.status,
          },
          {
            title: "CPU and memory",
            status: latest ? "ACTIVE" : "PENDING",
            description: latest
              ? `Latest sample reports ${Math.round(latest.cpuPercent)}% CPU and ${Math.round(latest.memoryPercent)}% memory utilization.`
              : "No CPU or memory rollups are available yet.",
            detail: latest ? formatUptime(latest.uptimeSeconds) : "No uptime data",
          },
          {
            title: "Disk and storage",
            status: latest ? "ACTIVE" : "PENDING",
            description: latest
              ? `Latest sample reports ${Math.round(latest.diskPercent)}% disk utilization for this compute node.`
              : "No disk rollups are available yet.",
            detail: payload.server.plan.diskGb + " GB allocated",
          },
          {
            title: "Network traffic",
            status: latest ? "ACTIVE" : "PENDING",
            description: latest
              ? `Ingress is ${Math.round(latest.networkInMbps)} Mbps and egress is ${Math.round(latest.networkOutMbps)} Mbps in the latest sample.`
              : "No network traffic rollups are available yet.",
            detail: `${monitoring.metrics.length} samples cached`,
          },
        ]}
      />

      <VpsSectionCard title="Monitoring posture" description="Thresholds, uptime health, and incident response controls.">
        <VpsDetailGrid
          items={[
            { label: "Status", value: monitoring.status },
            { label: "Monitoring", value: monitoring.enabled ? "Enabled" : "Disabled" },
            { label: "Samples", value: String(monitoring.metrics.length) },
            { label: "Last sync", value: monitoring.lastSyncedAt ? new Date(monitoring.lastSyncedAt).toLocaleString() : "Never" },
            { label: "Latest CPU", value: latest ? `${Math.round(latest.cpuPercent)}%` : "No data" },
            { label: "Latest memory", value: latest ? `${Math.round(latest.memoryPercent)}%` : "No data" },
            { label: "Latest disk", value: latest ? `${Math.round(latest.diskPercent)}%` : "No data" },
            { label: "Latest uptime", value: latest ? formatUptime(latest.uptimeSeconds) : "No data" },
          ]}
        />
      </VpsSectionCard>

      <div className="grid gap-4 xl:grid-cols-5">
        <VpsMetricCard label="CPU usage" value={latest ? `${Math.round(latest.cpuPercent)}%` : "0%"} helper="Latest sample" values={monitoring.metrics.map((metric) => metric.cpuPercent)} />
        <VpsMetricCard label="Memory usage" value={latest ? `${Math.round(latest.memoryPercent)}%` : "0%"} helper="Latest sample" values={monitoring.metrics.map((metric) => metric.memoryPercent)} accent="#235dbe" />
        <VpsMetricCard label="Disk usage" value={latest ? `${Math.round(latest.diskPercent)}%` : "0%"} helper="Latest sample" values={monitoring.metrics.map((metric) => metric.diskPercent)} accent="#3b82f6" />
        <VpsMetricCard label="Network in" value={latest ? `${Math.round(latest.networkInMbps)} Mbps` : "0 Mbps"} helper="Ingress" values={monitoring.metrics.map((metric) => metric.networkInMbps)} accent="#2563eb" />
        <VpsMetricCard label="Network out" value={latest ? `${Math.round(latest.networkOutMbps)} Mbps` : "0 Mbps"} helper="Egress" values={monitoring.metrics.map((metric) => metric.networkOutMbps)} accent="#1d4ed8" />
      </div>

      <VpsSectionCard title="Recent rollups" description="Latest cached provider telemetry for this VPS.">
        {!monitoring.metrics.length ? (
          <p className="text-sm text-[var(--ink-muted)]">No provider telemetry has been synced yet.</p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[var(--line)]">
            <table className="min-w-full border-collapse text-sm">
              <thead className="bg-[var(--surface-2)] text-left text-[var(--ink-muted)]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Captured</th>
                  <th className="px-4 py-3 font-semibold">CPU</th>
                  <th className="px-4 py-3 font-semibold">RAM</th>
                  <th className="px-4 py-3 font-semibold">Disk</th>
                  <th className="px-4 py-3 font-semibold">Net In</th>
                  <th className="px-4 py-3 font-semibold">Net Out</th>
                  <th className="px-4 py-3 font-semibold">Uptime</th>
                </tr>
              </thead>
              <tbody>
                {monitoring.metrics.map((metric) => (
                  <tr key={metric.capturedAt.toISOString()} className="border-t border-[var(--line)]">
                    <td className="px-4 py-3">{metric.capturedAt.toLocaleString()}</td>
                    <td className="px-4 py-3">{Math.round(metric.cpuPercent)}%</td>
                    <td className="px-4 py-3">{Math.round(metric.memoryPercent)}%</td>
                    <td className="px-4 py-3">{Math.round(metric.diskPercent)}%</td>
                    <td className="px-4 py-3">{Math.round(metric.networkInMbps)} Mbps</td>
                    <td className="px-4 py-3">{Math.round(metric.networkOutMbps)} Mbps</td>
                    <td className="px-4 py-3">{metric.uptimeSeconds}s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </VpsSectionCard>

    </div>
  );
}
