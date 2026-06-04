import { redirect } from "next/navigation";
import { getSession } from "../lib/auth";
import { loadAnalyticsData } from "../lib/modules/analytics";
import { ConsolePageShell } from "../components/ConsolePageShell";
import { SectionCard } from "../components/SectionCard";
import { DataTable, StatusPill } from "../components/DataTable";
import { StatsRow } from "../components/StatsRow";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const session = await getSession();
  if (!session) redirect("/console/login");
  const { events, goals, serviceEvents } = await loadAnalyticsData();

  const goalTotal = goals.reduce((acc, g) => acc + g.eventCount, 0);
  const uniqueSites = new Set(events.map((e) => e.siteId).filter(Boolean)).size;

  return (
    <ConsolePageShell
      session={session}
      activePath="/console/analytics"
      title="Analytics"
      subtitle={`${events.length} event(s) · ${goals.length} conversion goal(s)`}
    >
      <StatsRow
        stats={[
          { label: "Events (loaded)", value: events.length },
          { label: "Goal Events", value: goalTotal },
          { label: "Conversion Goals", value: goals.length },
          { label: "Service Events", value: serviceEvents.length },
        ]}
      />

      <SectionCard title="Conversion Goals">
        <DataTable
          columns={[
            { key: "name", header: "Goal", render: (g) => <span className="text-white">{g.name || g.id}</span> },
            { key: "count", header: "Events", align: "right" as const, render: (g) => <span className="font-mono text-slate-200">{g.eventCount.toLocaleString()}</span> },
          ]}
          rows={goals}
          rowKey={(g) => g.id}
          emptyTitle="No conversion goals defined"
          emptyDescription="Define goals to track key user actions across your properties."
        />
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Recent Analytics Events">
          <DataTable
            columns={[
              { key: "type", header: "Type", render: (e) => <span className="font-mono text-slate-300">{e.eventType || "—"}</span> },
              { key: "site", header: "Site", render: (e) => <span className="text-slate-300">{e.siteId || "—"}</span> },
              { key: "when", header: "When", render: (e) => e.createdAt ? new Date(e.createdAt).toLocaleString() : "—" },
            ]}
            rows={events}
            rowKey={(e) => e.id}
            emptyTitle="No events yet"
          />
        </SectionCard>

        <SectionCard title="Service Events">
          <DataTable
            columns={[
              { key: "kind", header: "Kind", render: (s) => s.kind || "—" },
              { key: "status", header: "Status", render: (s) => <StatusPill status={s.status || "unknown"} /> },
              { key: "when", header: "When", render: (s) => s.createdAt ? new Date(s.createdAt).toLocaleString() : "—" },
            ]}
            rows={serviceEvents}
            rowKey={(s) => s.id}
            emptyTitle="No service events"
          />
        </SectionCard>
      </div>
    </ConsolePageShell>
  );
}
