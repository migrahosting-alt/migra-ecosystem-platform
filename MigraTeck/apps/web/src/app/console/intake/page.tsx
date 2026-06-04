import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../lib/auth";
import { loadIntakeData } from "../lib/modules/intake";
import { ConsolePageShell } from "../components/ConsolePageShell";
import { SectionCard } from "../components/SectionCard";
import { DataTable, StatusPill } from "../components/DataTable";
import { StatsRow } from "../components/StatsRow";

export const dynamic = "force-dynamic";

export default async function IntakePage() {
  const session = await getSession();
  if (!session) redirect("/console/login");
  const { leads, forms } = await loadIntakeData();

  const now = new Date();
  const thisMonth = leads.filter((l) => {
    if (!l.createdAt) return false;
    const d = new Date(l.createdAt);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  const uncontacted = leads.filter((l) => ["new", "uncontacted"].includes(l.status)).length;

  return (
    <ConsolePageShell
      session={session}
      activePath="/console/intake"
      title="Intake"
      subtitle={`${leads.length} lead(s) · ${forms.length} form binding(s)`}
      actions={
        <Link
          href="/console/intake/new"
          className="rounded-full bg-gradient-to-r from-amber-500 to-yellow-500 px-4 py-1.5 text-xs font-semibold text-white shadow-lg shadow-amber-500/30 transition hover:shadow-amber-500/50"
        >
          + New Form Binding
        </Link>
      }
    >
      <StatsRow
        stats={[
          { label: "Total Leads", value: leads.length },
          { label: "This Month", value: thisMonth },
          { label: "Uncontacted", value: uncontacted, accent: uncontacted > 0 ? "warn" : "ok" },
          { label: "Form Bindings", value: forms.length },
        ]}
      />

      <SectionCard title="Recent Leads">
        <DataTable
          columns={[
            { key: "name", header: "Name", render: (l) => <span className="font-medium text-white">{l.name || "(no name)"}</span> },
            { key: "email", header: "Email", render: (l) => <span className="font-mono text-slate-300">{l.email || "—"}</span> },
            { key: "source", header: "Source", render: (l) => l.source || "—" },
            { key: "status", header: "Status", render: (l) => <StatusPill status={l.status} /> },
            { key: "when", header: "Received", render: (l) => l.createdAt ? new Date(l.createdAt).toLocaleString() : "—" },
          ]}
          rows={leads}
          rowKey={(l) => l.id}
          emptyTitle="No leads yet"
          emptyDescription="Create form bindings on your websites to start capturing leads."
        />
      </SectionCard>

      <SectionCard title="Form Bindings">
        <DataTable
          columns={[
            { key: "site", header: "Site / Form", render: (f) => <span className="font-medium text-white">{f.formname || f.id}</span> },
            { key: "provider", header: "Provider", render: (f) => <span className="text-slate-300">{f.provider || "—"}</span> },
            { key: "status", header: "Status", render: (f) => <StatusPill status={f.status} /> },
            { key: "subs", header: "Submissions", align: "right" as const, render: (f) => <span className="font-mono text-slate-200">{f.submissions.toLocaleString()}</span> },
          ]}
          rows={forms}
          rowKey={(f) => f.id}
          emptyTitle="No form bindings yet"
          emptyDescription="Connect a form to a website to start capturing leads."
        />
      </SectionCard>
    </ConsolePageShell>
  );
}
