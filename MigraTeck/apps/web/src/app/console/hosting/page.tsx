import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../lib/auth";
import { loadHostingData, loadHostingKpis } from "../lib/modules/hosting";
import { ConsolePageShell } from "../components/ConsolePageShell";
import { SectionCard } from "../components/SectionCard";
import { DataTable, StatusPill } from "../components/DataTable";
import { StatsRow } from "../components/StatsRow";

export const dynamic = "force-dynamic";

export default async function HostingPage() {
  const session = await getSession();
  if (!session) redirect("/console/login");

  const [{ websites, deployments, tasks }, kpis] = await Promise.all([
    loadHostingData(),
    loadHostingKpis(),
  ]);

  return (
    <ConsolePageShell
      session={session}
      activePath="/console/hosting"
      title="Hosting"
      subtitle={`${kpis.totalSites} site(s) · ${kpis.queuedTasks} task(s) in queue · ${kpis.expiringSslCount} SSL expiring soon`}
      actions={
        <Link
          href="/console/hosting/new"
          className="rounded-full bg-gradient-to-r from-sky-500 to-cyan-500 px-4 py-1.5 text-xs font-semibold text-white shadow-lg shadow-sky-500/30 transition hover:shadow-sky-500/50"
        >
          + New Hosting
        </Link>
      }
    >
      <StatsRow
        stats={[
          { label: "Total Sites", value: kpis.totalSites },
          { label: "Active", value: kpis.activeSites, accent: "ok" },
          { label: "SSL Expiring (30d)", value: kpis.expiringSslCount, accent: kpis.expiringSslCount > 0 ? "warn" : "ok" },
          { label: "Deploys (7d)", value: kpis.recentDeployments },
          { label: "Queued Tasks", value: kpis.queuedTasks, accent: kpis.queuedTasks > 0 ? "warn" : undefined },
        ]}
      />

      <SectionCard
        title="Websites"
        subtitle="Click a domain to drill into per-site management (SSL, DNS, deploys, backups, operations)."
      >
        <DataTable
          columns={[
            {
              key: "domain",
              header: "Domain",
              render: (w) => (
                <Link href={`/console/hosting/${w.id}`} className="block hover:text-fuchsia-200">
                  <span className="font-medium text-white">{w.domain || "(no domain)"}</span>
                </Link>
              ),
            },
            { key: "client", header: "Client", render: (w) => w.tenantName || "—" },
            { key: "status", header: "Status", render: (w) => <StatusPill status={w.status} /> },
            {
              key: "updated",
              header: "Updated",
              render: (w) =>
                w.updatedAt ? new Date(w.updatedAt).toLocaleDateString() : "—",
            },
            {
              key: "actions",
              header: "",
              align: "right" as const,
              render: (w) => (
                <div className="inline-flex items-center gap-1">
                  <Link
                    href={`/console/hosting/${w.id}`}
                    className="rounded-md border border-fuchsia-400/30 bg-fuchsia-500/10 px-2.5 py-1 text-[10px] font-medium text-fuchsia-200 transition hover:bg-fuchsia-500/20"
                  >
                    Manage
                  </Link>
                  <Link
                    href={`/console/hosting/${w.id}/edit`}
                    className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-medium text-slate-300 transition hover:bg-white/10 hover:text-white"
                  >
                    Edit
                  </Link>
                </div>
              ),
            },
          ]}
          rows={websites}
          rowKey={(w) => w.id}
          emptyTitle="No websites yet"
          emptyDescription="Add your first hosting account to get started."
        />
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Recent Deployments">
          <DataTable
            columns={[
              { key: "site", header: "Site", render: (d) => d.siteName || d.id },
              { key: "status", header: "Status", render: (d) => <StatusPill status={d.status} /> },
              {
                key: "when",
                header: "When",
                render: (d) =>
                  d.createdAt ? new Date(d.createdAt).toLocaleString() : "—",
              },
            ]}
            rows={deployments}
            rowKey={(d) => d.id}
            emptyTitle="No deployments yet"
          />
        </SectionCard>

        <SectionCard title="Provisioning Queue">
          <DataTable
            columns={[
              { key: "type", header: "Type", render: (t) => t.type || "task" },
              { key: "status", header: "Status", render: (t) => <StatusPill status={t.status} /> },
              {
                key: "when",
                header: "Queued",
                render: (t) =>
                  t.createdAt ? new Date(t.createdAt).toLocaleString() : "—",
              },
            ]}
            rows={tasks}
            rowKey={(t) => t.id}
            emptyTitle="Queue is empty"
            emptyDescription="All provisioning tasks have completed."
          />
        </SectionCard>
      </div>
    </ConsolePageShell>
  );
}
