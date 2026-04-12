import { notFound } from "next/navigation";
import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { getVpsDashboardPayload, getVpsMonitoringState } from "@/lib/vps/data";
import { VpsDetailGrid, VpsMetricCard } from "@/components/app/vps-ui";

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
      <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_18px_42px_rgba(15,23,42,0.06)]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Monitoring</p>
        <h2 className="mt-1 text-[32px] font-semibold tracking-tight text-slate-950">Monitoring Unavailable</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Live monitoring is intentionally disabled for {payload.server.providerSlug}. Cached VPS metadata remains available elsewhere in the workspace, but metric-driven charts and monitoring APIs stay blocked until the provider exposes a supported telemetry contract.
        </p>
      </section>
    );
  }

  const monitoring = await getVpsMonitoringState(serverId, membership.orgId);

  if (!monitoring) {
    notFound();
  }

  const latest = monitoring.metrics[monitoring.metrics.length - 1];

  const statusTone = monitoring.enabled
    ? monitoring.status === "HEALTHY"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : "border-amber-200 bg-amber-50 text-amber-800"
    : "border-slate-200 bg-slate-100 text-slate-700";

  return (
    <div className="space-y-4 pb-6">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Telemetry state</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{monitoring.enabled ? monitoring.status : "Disabled"}</p>
          <p className="mt-3 text-sm leading-6 text-slate-500">{monitoring.metrics.length} cached samples available for this server.</p>
        </article>
        <article className="rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">CPU</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{latest ? `${Math.round(latest.cpuPercent)}%` : "No data"}</p>
          <p className="mt-3 text-sm leading-6 text-slate-500">Latest compute pressure sample for this node.</p>
        </article>
        <article className="rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Memory</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{latest ? `${Math.round(latest.memoryPercent)}%` : "No data"}</p>
          <p className="mt-3 text-sm leading-6 text-slate-500">Latest in-memory utilization sample.</p>
        </article>
        <article className="rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Uptime</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{latest ? formatUptime(latest.uptimeSeconds) : "No data"}</p>
          <p className="mt-3 text-sm leading-6 text-slate-500">Most recent runtime continuity reading.</p>
        </article>
      </section>

      <div className="grid grid-cols-12 gap-4 xl:items-start">
        <section className="col-span-12 rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_18px_42px_rgba(15,23,42,0.06)] xl:col-span-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Monitoring fabric</p>
              <h2 className="mt-1 text-[32px] font-semibold tracking-tight text-slate-950">Telemetry Command Surface</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Live cached provider metrics for compute, storage, and network throughput, organized for rapid operational review.
              </p>
            </div>
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${statusTone}`}>
              {monitoring.status}
            </span>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-5">
        <VpsMetricCard label="CPU usage" value={latest ? `${Math.round(latest.cpuPercent)}%` : "0%"} helper="Latest sample" values={monitoring.metrics.map((metric) => metric.cpuPercent)} />
        <VpsMetricCard label="Memory usage" value={latest ? `${Math.round(latest.memoryPercent)}%` : "0%"} helper="Latest sample" values={monitoring.metrics.map((metric) => metric.memoryPercent)} accent="#235dbe" />
        <VpsMetricCard label="Disk usage" value={latest ? `${Math.round(latest.diskPercent)}%` : "0%"} helper="Latest sample" values={monitoring.metrics.map((metric) => metric.diskPercent)} accent="#3b82f6" />
        <VpsMetricCard label="Network in" value={latest ? `${Math.round(latest.networkInMbps)} Mbps` : "0 Mbps"} helper="Ingress" values={monitoring.metrics.map((metric) => metric.networkInMbps)} accent="#2563eb" />
        <VpsMetricCard label="Network out" value={latest ? `${Math.round(latest.networkOutMbps)} Mbps` : "0 Mbps"} helper="Egress" values={monitoring.metrics.map((metric) => metric.networkOutMbps)} accent="#1d4ed8" />
      </div>

        </section>

        <aside className="col-span-12 space-y-4 xl:col-span-4">
          <section className="rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-[0_16px_36px_rgba(15,23,42,0.06)]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Signal posture</p>
            <h3 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">Monitoring State</h3>
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                <span className="text-slate-600">Monitoring</span>
                <span className="font-semibold text-slate-950">{monitoring.enabled ? "Enabled" : "Disabled"}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                <span className="text-slate-600">Last sync</span>
                <span className="font-semibold text-slate-950">{monitoring.lastSyncedAt ? new Date(monitoring.lastSyncedAt).toLocaleString() : "Never"}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                <span className="text-slate-600">Samples</span>
                <span className="font-semibold text-slate-950">{monitoring.metrics.length}</span>
              </div>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {latest
                ? `Latest sample shows ${Math.round(latest.cpuPercent)}% CPU, ${Math.round(latest.memoryPercent)}% memory, and ${Math.round(latest.diskPercent)}% disk usage.`
                : "No provider rollup has been synced yet for this server."}
            </p>
          </section>
        </aside>
      </div>

      <div className="grid grid-cols-12 gap-4 xl:items-start">
        <section className="col-span-12 rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_16px_36px_rgba(15,23,42,0.05)] xl:col-span-5">
          <div className="mb-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Monitoring posture</p>
            <h2 className="mt-1 text-[28px] font-semibold tracking-tight text-slate-950">Telemetry Inventory</h2>
          </div>
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
        </section>

        <section className="col-span-12 rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_16px_36px_rgba(15,23,42,0.05)] xl:col-span-7">
          <div className="mb-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Rollup history</p>
            <h2 className="mt-1 text-[28px] font-semibold tracking-tight text-slate-950">Recent Samples</h2>
          </div>
        {!monitoring.metrics.length ? (
          <p className="text-sm text-slate-600">No provider telemetry has been synced yet.</p>
        ) : (
          <div className="overflow-hidden rounded-[22px] border border-slate-200">
            <table className="min-w-full border-collapse text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
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
                  <tr key={metric.capturedAt.toISOString()} className="border-t border-slate-200">
                    <td className="px-4 py-3">{metric.capturedAt.toLocaleString()}</td>
                    <td className="px-4 py-3">{Math.round(metric.cpuPercent)}%</td>
                    <td className="px-4 py-3">{Math.round(metric.memoryPercent)}%</td>
                    <td className="px-4 py-3">{Math.round(metric.diskPercent)}%</td>
                    <td className="px-4 py-3">{Math.round(metric.networkInMbps)} Mbps</td>
                    <td className="px-4 py-3">{Math.round(metric.networkOutMbps)} Mbps</td>
                    <td className="px-4 py-3">{formatUptime(metric.uptimeSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </section>
      </div>
    </div>
  );
}
