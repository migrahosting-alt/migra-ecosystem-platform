import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../lib/auth";
import { loadAutomationData } from "../lib/modules/automation";
import { ConsolePageShell } from "../components/ConsolePageShell";
import { SectionCard } from "../components/SectionCard";
import { DataTable, StatusPill } from "../components/DataTable";
import { StatsRow } from "../components/StatsRow";

export const dynamic = "force-dynamic";

export default async function AutomationPage() {
  const session = await getSession();
  if (!session) redirect("/console/login");
  const { jobs, runs, webhooks } = await loadAutomationData();

  const activeJobs = jobs.filter((j) => j.status === "active").length;
  const succeeded = runs.filter((r) => r.status === "succeeded").length;
  const successRate =
    runs.length > 0 ? Math.round((succeeded / runs.length) * 100) : 0;

  return (
    <ConsolePageShell
      session={session}
      activePath="/console/automation"
      title="Automation"
      subtitle={`${jobs.length} job(s) · ${runs.length} recent run(s) · ${webhooks.length} webhook(s)`}
      actions={
        <Link
          href="/console/automation/new"
          className="rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 px-4 py-1.5 text-xs font-semibold text-white shadow-lg shadow-blue-500/30 transition hover:shadow-blue-500/50"
        >
          + New Job
        </Link>
      }
    >
      <StatsRow
        stats={[
          { label: "Jobs", value: jobs.length },
          { label: "Active", value: activeJobs, accent: "ok" },
          {
            label: "Success Rate",
            value: `${successRate}%`,
            accent: successRate >= 80 ? "ok" : successRate >= 50 ? "warn" : "bad",
            sub: `${runs.length} runs evaluated`,
          },
          { label: "Webhooks", value: webhooks.length },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Jobs">
          <DataTable
            columns={[
              {
                key: "name",
                header: "Name",
                render: (j) => (
                  <div>
                    <p className="text-white">{j.name || j.id}</p>
                    {j.type && j.type !== j.name && (
                      <p className="text-[10px] text-slate-500">{j.type}</p>
                    )}
                  </div>
                ),
              },
              { key: "status", header: "Status", render: (j) => <StatusPill status={j.status} /> },
              {
                key: "actions",
                header: "",
                align: "right" as const,
                render: (j) => (
                  <Link href={`/console/automation/${j.id}/edit`} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-medium text-slate-300 transition hover:bg-white/10 hover:text-white">
                    Edit
                  </Link>
                ),
              },
            ]}
            rows={jobs}
            rowKey={(j) => j.id}
            emptyTitle="No jobs defined"
            emptyDescription="Create a job to start automating workflows."
          />
        </SectionCard>

        <SectionCard title="Recent Runs">
          <DataTable
            columns={[
              { key: "job", header: "Job", render: (r) => r.jobName || r.jobId || r.id },
              { key: "status", header: "Status", render: (r) => <StatusPill status={r.status} /> },
              {
                key: "started",
                header: "Started",
                render: (r) => r.startedAt ? new Date(r.startedAt).toLocaleString() : "—",
              },
            ]}
            rows={runs}
            rowKey={(r) => r.id}
            emptyTitle="No runs yet"
          />
        </SectionCard>
      </div>

      <SectionCard title="Webhook Endpoints">
        <DataTable
          columns={[
            { key: "url", header: "URL", render: (w) => <span className="font-mono text-slate-200">{w.url || "—"}</span> },
            { key: "status", header: "Status", render: (w) => <StatusPill status={w.status} /> },
            {
              key: "last",
              header: "Last Fired",
              render: (w) => w.lastFiredAt ? new Date(w.lastFiredAt).toLocaleString() : "Never",
            },
          ]}
          rows={webhooks}
          rowKey={(w) => w.id}
          emptyTitle="No webhooks configured"
          emptyDescription="Add a webhook endpoint to receive event notifications."
        />
      </SectionCard>
    </ConsolePageShell>
  );
}
