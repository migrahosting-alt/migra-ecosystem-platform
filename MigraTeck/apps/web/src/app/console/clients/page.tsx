import { redirect } from "next/navigation";
import Link from "next/link";

import { getSession } from "../lib/auth";
import { loadAllClients, loadDistinctClientStatuses } from "../lib/modules/clients";
import { ConsolePageShell } from "../components/ConsolePageShell";
import { SectionCard } from "../components/SectionCard";
import { DataTable, StatusPill } from "../components/DataTable";
import { StatsRow } from "../components/StatsRow";
import { ClientSearchBar } from "../components/ClientSearchBar";

export const dynamic = "force-dynamic";

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/console/login");

  const sp = await searchParams;
  const q = (sp.q || "").trim();
  const statusFilter = (sp.status || "").trim();

  const [clients, statuses] = await Promise.all([
    loadAllClients({ q, status: statusFilter, limit: 500 }),
    loadDistinctClientStatuses(),
  ]);

  const now = new Date();
  const activeCount = clients.filter((c) => c.status === "active").length;
  const newThisMonth = clients.filter((c) => {
    if (!c.createdAt) return false;
    const d = new Date(c.createdAt);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  const avgServices =
    clients.length > 0
      ? (clients.reduce((acc, c) => acc + c.serviceCount, 0) / clients.length).toFixed(1)
      : "0";

  const filtered = q || statusFilter;

  return (
    <ConsolePageShell
      session={session}
      activePath="/console/clients"
      title="Clients"
      subtitle={
        filtered
          ? `${clients.length} match${clients.length === 1 ? "" : "es"}`
          : `${clients.length} active client account${clients.length === 1 ? "" : "s"}`
      }
      actions={
        <Link
          href="/console/clients/new"
          className="rounded-full bg-gradient-to-r from-fuchsia-500 to-pink-500 px-4 py-1.5 text-xs font-semibold text-white shadow-lg shadow-fuchsia-500/30 transition hover:shadow-fuchsia-500/50"
        >
          + Add Client
        </Link>
      }
    >
      <StatsRow
        stats={[
          { label: "Total Clients", value: clients.length },
          { label: "Active", value: activeCount, accent: "ok" },
          { label: "New This Month", value: newThisMonth },
          { label: "Avg Services", value: avgServices, sub: "active subscriptions per client" },
        ]}
      />

      <SectionCard title="All Clients">
        <div className="mb-3">
          <ClientSearchBar statuses={statuses} />
        </div>
        <DataTable
          columns={[
            {
              key: "client",
              header: "Client",
              render: (c) => (
                <Link href={`/console/clients/${c.id}`} className="block hover:text-fuchsia-200">
                  <p className="font-semibold text-white">{c.name}</p>
                  {c.domain && <p className="text-[10px] text-slate-500">{c.domain}</p>}
                </Link>
              ),
            },
            { key: "type", header: "Type", render: (c) => <span className="text-slate-300">{c.tenantType}</span> },
            { key: "services", header: "Active Services", render: (c) => <span className="text-slate-200">{c.serviceCount}</span> },
            { key: "email", header: "Billing Email", render: (c) => <span className="text-slate-300">{c.primaryEmail || "—"}</span> },
            { key: "status", header: "Status", render: (c) => <StatusPill status={c.status} /> },
            { key: "created", header: "Since", render: (c) => c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "—" },
            {
              key: "actions",
              header: "",
              align: "right" as const,
              render: (c) => (
                <Link href={`/console/clients/${c.id}`} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-medium text-slate-300 transition hover:bg-white/10 hover:text-white">
                  View
                </Link>
              ),
            },
          ]}
          rows={clients}
          rowKey={(c) => c.id}
          emptyTitle={filtered ? "No matches" : "No clients yet"}
          emptyDescription={
            filtered
              ? "Try a different search term or clear the status filter."
              : "Add your first client account to get started."
          }
        />
      </SectionCard>
    </ConsolePageShell>
  );
}
