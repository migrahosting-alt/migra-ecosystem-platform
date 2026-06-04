import { redirect } from "next/navigation";
import { getSession } from "../lib/auth";
import { loadEmailData } from "../lib/modules/email";
import { ConsolePageShell } from "../components/ConsolePageShell";
import { SectionCard } from "../components/SectionCard";
import { DataTable, StatusPill } from "../components/DataTable";
import { StatsRow } from "../components/StatsRow";

export const dynamic = "force-dynamic";

export default async function EmailPage() {
  const session = await getSession();
  if (!session) redirect("/console/login");
  const { domains, mailboxes, aliases } = await loadEmailData();

  const activeMailboxes = mailboxes.filter((m) => m.status === "active").length;

  return (
    <ConsolePageShell
      session={session}
      activePath="/console/email"
      title="Email"
      subtitle={`${domains.length} domain(s) · ${mailboxes.length} mailbox(es) · ${aliases.length} alias(es)`}
      actions={
        <a
          href="/console/email/new"
          className="rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-1.5 text-xs font-semibold text-white shadow-lg shadow-emerald-500/30 transition hover:shadow-emerald-500/50"
        >
          + New Mailbox
        </a>
      }
    >
      <StatsRow
        stats={[
          { label: "Mail Domains", value: domains.length },
          { label: "Total Mailboxes", value: mailboxes.length },
          { label: "Active", value: activeMailboxes, accent: "ok" },
          { label: "Aliases", value: aliases.length },
        ]}
      />

      <SectionCard title="Mail Domains">
        <DataTable
          columns={[
            { key: "domain", header: "Domain", render: (d) => <span className="font-medium text-white">{d.domain}</span> },
            { key: "client", header: "Client", render: (d) => d.tenantName || "—" },
            { key: "status", header: "Status", render: (d) => <StatusPill status={d.status} /> },
          ]}
          rows={domains}
          rowKey={(d) => d.id}
          emptyTitle="No mail domains yet"
        />
      </SectionCard>

      <SectionCard title="Mailboxes">
        <DataTable
          columns={[
            { key: "address", header: "Address", render: (m) => <span className="font-mono text-slate-200">{m.address}</span> },
            { key: "client", header: "Client", render: (m) => m.tenantName || "—" },
            { key: "status", header: "Status", render: (m) => <StatusPill status={m.status} /> },
            { key: "created", header: "Created", render: (m) => m.createdAt ? new Date(m.createdAt).toLocaleDateString() : "—" },
          ]}
          rows={mailboxes}
          rowKey={(m) => m.id}
          emptyTitle="No mailboxes yet"
          emptyDescription="Create a mailbox to start sending and receiving email."
        />
      </SectionCard>

      <SectionCard title="Aliases & Forwarders">
        <DataTable
          columns={[
            { key: "src", header: "Source", render: (a) => <span className="font-mono text-slate-300">{a.sourceLocal}</span> },
            { key: "dst", header: "Destination", render: (a) => <span className="text-slate-300">{a.destination}</span> },
            { key: "active", header: "Active", render: (a) => <StatusPill status={a.isActive ? "active" : "paused"} /> },
          ]}
          rows={aliases}
          rowKey={(a) => a.id}
          emptyTitle="No aliases configured"
        />
      </SectionCard>
    </ConsolePageShell>
  );
}
