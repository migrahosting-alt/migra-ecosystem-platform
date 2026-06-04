import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../lib/auth";
import { loadDomainsData } from "../lib/modules/domains";
import { ConsolePageShell } from "../components/ConsolePageShell";
import { SectionCard } from "../components/SectionCard";
import { DataTable, StatusPill } from "../components/DataTable";
import { StatsRow } from "../components/StatsRow";

export const dynamic = "force-dynamic";

export default async function DomainsPage() {
  const session = await getSession();
  if (!session) redirect("/console/login");
  const { domains, zones, transfers } = await loadDomainsData();

  const active = domains.filter((d) => d.status === "active").length;
  const expiringSoon = domains.filter((d) => {
    if (!d.expiresAt) return false;
    const days = (new Date(d.expiresAt).getTime() - Date.now()) / 86_400_000;
    return days >= 0 && days <= 30;
  }).length;

  return (
    <ConsolePageShell
      session={session}
      activePath="/console/domains"
      title="Domains"
      subtitle={`${domains.length} domain(s) · ${zones.length} DNS zone(s) · ${transfers.length} pending transfer(s)`}
      actions={
        <Link
          href="/console/domains/new"
          className="rounded-full bg-gradient-to-r from-violet-500 to-purple-500 px-4 py-1.5 text-xs font-semibold text-white shadow-lg shadow-violet-500/30 transition hover:shadow-violet-500/50"
        >
          + Add Domain
        </Link>
      }
    >
      <StatsRow
        stats={[
          { label: "Total Domains", value: domains.length },
          { label: "Active", value: active, accent: "ok" },
          { label: "Expiring (30d)", value: expiringSoon, accent: expiringSoon > 0 ? "warn" : undefined },
          { label: "DNS Zones", value: zones.length },
        ]}
      />

      <SectionCard title="All Domains">
        <DataTable
          columns={[
            { key: "domain", header: "Domain", render: (d) => <span className="font-medium text-white">{d.domain}</span> },
            { key: "client", header: "Client", render: (d) => d.tenantName || "—" },
            { key: "role", header: "Role", render: (d) => d.role },
            { key: "status", header: "Status", render: (d) => <StatusPill status={d.status} /> },
            {
              key: "expires",
              header: "Expires",
              render: (d) => {
                if (!d.expiresAt) return "—";
                const days = Math.ceil((new Date(d.expiresAt).getTime() - Date.now()) / 86_400_000);
                const cls = days <= 7 ? "text-rose-400" : days <= 30 ? "text-amber-400" : "text-slate-400";
                return <span className={`font-mono text-[11px] ${cls}`}>{new Date(d.expiresAt).toLocaleDateString()}</span>;
              },
            },
            {
              key: "actions",
              header: "",
              align: "right" as const,
              render: (d) => (
                <Link href={`/console/domains/${d.id}/edit`} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-medium text-slate-300 transition hover:bg-white/10 hover:text-white">
                  Edit
                </Link>
              ),
            },
          ]}
          rows={domains}
          rowKey={(d) => d.id}
          emptyTitle="No domains yet"
          emptyDescription="Add a domain to start managing DNS and hosting."
        />
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="DNS Zones">
          <DataTable
            columns={[
              { key: "zone", header: "Zone", render: (z) => <span className="font-mono text-white">{z.zone}</span> },
              { key: "status", header: "Status", render: (z) => <StatusPill status={z.status} /> },
            ]}
            rows={zones}
            rowKey={(z) => z.id}
            emptyTitle="No DNS zones"
          />
        </SectionCard>
        <SectionCard title="Pending Transfers">
          <DataTable
            columns={[
              { key: "domain", header: "Domain", render: (t) => t.domain || t.id },
              { key: "status", header: "Status", render: (t) => <StatusPill status={t.status} /> },
            ]}
            rows={transfers}
            rowKey={(t) => t.id}
            emptyTitle="No pending transfers"
          />
        </SectionCard>
      </div>
    </ConsolePageShell>
  );
}
