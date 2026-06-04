import { redirect } from "next/navigation";
import { getSession } from "../lib/auth";
import { loadVoiceData } from "../lib/modules/voice";
import { ConsolePageShell } from "../components/ConsolePageShell";
import { SectionCard } from "../components/SectionCard";
import { DataTable, StatusPill } from "../components/DataTable";
import { StatsRow } from "../components/StatsRow";

export const dynamic = "force-dynamic";

export default async function VoicePage() {
  const session = await getSession();
  if (!session) redirect("/console/login");
  const { numbers, extensions, ivrs } = await loadVoiceData();

  const enabled = extensions.filter((e) => e.enabled).length;

  return (
    <ConsolePageShell
      session={session}
      activePath="/console/voice"
      title="Voice"
      subtitle={`${numbers.length} number(s) · ${extensions.length} extension(s) · ${ivrs.length} IVR(s)`}
      actions={
        <a
          href="/console/voice/new"
          className="rounded-full bg-gradient-to-r from-rose-500 to-orange-500 px-4 py-1.5 text-xs font-semibold text-white shadow-lg shadow-rose-500/30 transition hover:shadow-rose-500/50"
        >
          + Add Number
        </a>
      }
    >
      <StatsRow
        stats={[
          { label: "Phone Numbers", value: numbers.length },
          { label: "Extensions", value: extensions.length },
          { label: "Enabled", value: enabled, accent: "ok" },
          { label: "IVRs", value: ivrs.length },
        ]}
      />

      <SectionCard title="Phone Numbers">
        <DataTable
          columns={[
            { key: "num", header: "Number", render: (n) => <span className="font-mono text-white">{n.number}</span> },
            { key: "client", header: "Client", render: (n) => n.tenantName || "—" },
            { key: "status", header: "Status", render: (n) => <StatusPill status={n.status} /> },
          ]}
          rows={numbers}
          rowKey={(n) => n.id}
          emptyTitle="No phone numbers yet"
          emptyDescription="Add a DID number to start routing calls."
        />
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Extensions">
          <DataTable
            columns={[
              { key: "ext", header: "Extension", render: (e) => <span className="font-mono">{e.extension}</span> },
              { key: "name", header: "Display Name", render: (e) => e.displayName || "—" },
              { key: "status", header: "Enabled", render: (e) => <StatusPill status={e.enabled ? "active" : "paused"} /> },
            ]}
            rows={extensions}
            rowKey={(e) => e.id}
            emptyTitle="No extensions yet"
          />
        </SectionCard>
        <SectionCard title="IVRs">
          <DataTable
            columns={[
              { key: "name", header: "Name", render: (i) => i.name },
              { key: "status", header: "Status", render: (i) => <StatusPill status={i.status} /> },
            ]}
            rows={ivrs}
            rowKey={(i) => i.id}
            emptyTitle="No IVRs configured"
            emptyDescription="Create an IVR to build call routing menus."
          />
        </SectionCard>
      </div>
    </ConsolePageShell>
  );
}
