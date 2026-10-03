import { redirect } from "next/navigation";
import { getSession } from "../lib/auth";
import { loadVoiceData, loadVoiceRuntime } from "../lib/modules/voice";
import { ConsolePageShell } from "../components/ConsolePageShell";
import { SectionCard } from "../components/SectionCard";
import { DataTable, StatusPill } from "../components/DataTable";
import { StatsRow } from "../components/StatsRow";

export const dynamic = "force-dynamic";

export default async function VoicePage() {
  const session = await getSession();
  if (!session) redirect("/console/login");
  const [{ numbers, extensions, ivrs }, { approvals, deployments }] = await Promise.all([
    loadVoiceData(),
    loadVoiceRuntime(),
  ]);

  const enabled = extensions.filter((e) => e.enabled).length;
  const liveApprovals = approvals.filter((a) => a.enabled).length;

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
          { label: "Live-apply approved", value: liveApprovals },
        ]}
      />

      <SectionCard title="Live-apply approvals">
        <p className="mb-3 text-[11px] leading-relaxed text-slate-400">
          Publishing a customer&apos;s phone setup to the PBX needs three things to line up: two
          service flags on panel-api (<span className="font-mono">BUSINESS_PHONE_FREEPBX_RUNTIME</span>{" "}
          and <span className="font-mono">BUSINESS_PHONE_RUNTIME_DRY_RUN</span>) and an enabled row
          here. Only this row is stored in the panel database — the two flags belong to the
          panel-api service and are not readable from the console, so a customer shown as approved
          below is not on its own proof that a live publish will run.
        </p>
        <DataTable
          columns={[
            { key: "customer", header: "Customer", render: (a) => <span className="font-mono text-white">{a.customerId}</span> },
            { key: "state", header: "Live apply", render: (a) => <StatusPill status={a.enabled ? "active" : "paused"} /> },
            { key: "by", header: "Approved by", render: (a) => a.approvedBy || "—" },
            { key: "at", header: "Approved at", render: (a) => a.approvedAt || "—" },
            { key: "notes", header: "Notes", render: (a) => a.notes || "—" },
          ]}
          rows={approvals}
          rowKey={(a) => a.id}
          emptyTitle="No approval rows"
          emptyDescription="No customer has been granted or denied live-apply yet."
        />
      </SectionCard>

      <SectionCard title="Recent publishes">
        <DataTable
          columns={[
            { key: "customer", header: "Customer", render: (d) => <span className="font-mono text-white">{d.customerId}</span> },
            { key: "status", header: "Status", render: (d) => <StatusPill status={d.status} /> },
            { key: "mode", header: "Mode", render: (d) => (d.dryRun ? "Dry run" : "Live") },
            { key: "adapter", header: "Adapter", render: (d) => d.adapterLabel || "—" },
            { key: "plan", header: "Plan", render: (d) => <span className="font-mono text-[11px]">{d.planHash || "—"}</span> },
            { key: "at", header: "When", render: (d) => d.at || "—" },
          ]}
          rows={deployments}
          rowKey={(d) => d.id}
          emptyTitle="No publishes recorded"
          emptyDescription="A customer's phone setup has not been published from the portal yet."
        />
      </SectionCard>

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
