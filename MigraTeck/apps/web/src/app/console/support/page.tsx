import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../lib/auth";
import { loadSupportData } from "../lib/modules/support";
import { ConsolePageShell } from "../components/ConsolePageShell";
import { SectionCard } from "../components/SectionCard";
import { DataTable, StatusPill } from "../components/DataTable";
import { StatsRow } from "../components/StatsRow";

export const dynamic = "force-dynamic";

export default async function SupportPage() {
  const session = await getSession();
  if (!session) redirect("/console/login");
  const { tickets, agents } = await loadSupportData();

  const open = tickets.filter((t) => !["closed", "resolved"].includes(t.status.toLowerCase()));
  const unassigned = open.filter((t) => !t.assigneeName || t.assigneeName === "Unassigned");
  const highPriority = open.filter((t) => ["critical", "high"].includes(t.priority?.toLowerCase() ?? ""));

  return (
    <ConsolePageShell
      session={session}
      activePath="/console/support"
      title="Support"
      subtitle={`${open.length} open ticket(s) · ${agents.length} agent(s)`}
      actions={
        <Link
          href="/console/support/new"
          className="rounded-full bg-gradient-to-r from-slate-500 to-slate-600 px-4 py-1.5 text-xs font-semibold text-white shadow-lg transition hover:bg-white/10"
        >
          + New Ticket
        </Link>
      }
    >
      <StatsRow
        stats={[
          { label: "Open Tickets", value: open.length, accent: open.length > 0 ? "warn" : "ok" },
          { label: "Unassigned", value: unassigned.length, accent: unassigned.length > 0 ? "warn" : undefined },
          { label: "High Priority", value: highPriority.length, accent: highPriority.length > 0 ? "bad" : undefined },
          { label: "Support Agents", value: agents.length },
        ]}
      />

      <SectionCard title="Open Tickets">
        <DataTable
          columns={[
            { key: "subject", header: "Subject", render: (t) => <span className="text-white">{t.subject || "(no subject)"}</span> },
            { key: "client", header: "Client", render: (t) => t.tenantName || "—" },
            {
              key: "priority",
              header: "Priority",
              render: (t) => (
                <StatusPill
                  status={t.priority || "normal"}
                  variant={
                    t.priority === "critical" ? "bad"
                    : t.priority === "high" ? "warn"
                    : "neutral"
                  }
                />
              ),
            },
            { key: "assignee", header: "Assignee", render: (t) => t.assigneeName || <span className="text-amber-400">Unassigned</span> },
            { key: "status", header: "Status", render: (t) => <StatusPill status={t.status} /> },
            { key: "when", header: "Opened", render: (t) => t.createdAt ? new Date(t.createdAt).toLocaleDateString() : "—" },
            {
              key: "actions",
              header: "",
              align: "right" as const,
              render: (t) => (
                <Link href={`/console/support/${t.id}/edit`} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-medium text-slate-300 transition hover:bg-white/10 hover:text-white">
                  Edit
                </Link>
              ),
            },
          ]}
          rows={open}
          rowKey={(t) => t.id}
          emptyTitle="Inbox clear"
          emptyDescription="No open tickets right now. Great work!"
        />
      </SectionCard>

      <SectionCard title="Agents on Duty">
        <DataTable
          columns={[
            { key: "name", header: "Agent", render: (a) => <span className="text-white">{a.name}</span> },
            { key: "status", header: "Status", render: (a) => <StatusPill status={a.status} /> },
            { key: "open", header: "Open Tickets", align: "right" as const, render: (a) => <span className="font-mono text-slate-200">{a.openTickets}</span> },
          ]}
          rows={agents}
          rowKey={(a) => a.id}
          emptyTitle="No agents yet"
        />
      </SectionCard>
    </ConsolePageShell>
  );
}
