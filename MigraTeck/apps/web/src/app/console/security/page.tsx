import { redirect } from "next/navigation";
import { getSession } from "../lib/auth";
import { loadSecurityData } from "../lib/modules/security";
import { ConsolePageShell } from "../components/ConsolePageShell";
import { SectionCard } from "../components/SectionCard";
import { DataTable, StatusPill } from "../components/DataTable";
import { StatsRow } from "../components/StatsRow";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const session = await getSession();
  if (!session) redirect("/console/login");
  const { events, failedLogins, incidents, certs } = await loadSecurityData();

  const activeIncidents = incidents.filter(
    (i) => !["resolved", "closed"].includes(i.status?.toLowerCase() ?? ""),
  ).length;

  return (
    <ConsolePageShell
      session={session}
      activePath="/console/security"
      title="Security"
      subtitle={`${events.length} audit event(s) · ${incidents.length} incident(s) · ${certs.length} certificate(s)`}
    >
      <StatsRow
        stats={[
          { label: "Audit Events", value: events.length },
          { label: "Failed Logins", value: failedLogins.length, accent: failedLogins.length > 0 ? "warn" : undefined },
          { label: "Active Incidents", value: activeIncidents, accent: activeIncidents > 0 ? "bad" : undefined },
          { label: "Certificates", value: certs.length },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Recent Audit Events">
          <DataTable
            columns={[
              { key: "action", header: "Action", render: (e) => <span className="font-mono text-slate-300">{e.actionKey}</span> },
              { key: "resource", header: "Resource", render: (e) => <span className="text-slate-300">{e.resourceType}</span> },
              { key: "actor", header: "Actor", render: (e) => e.actorEmail || "System" },
              {
                key: "decision",
                header: "Decision",
                render: (e) => (
                  <StatusPill
                    status={e.decision}
                    variant={e.decision === "allow" ? "ok" : e.decision === "deny" ? "bad" : "neutral"}
                  />
                ),
              },
              { key: "when", header: "When", render: (e) => e.createdAt ? new Date(e.createdAt).toLocaleString() : "—" },
            ]}
            rows={events}
            rowKey={(e) => e.id}
            emptyTitle="No audit events yet"
          />
        </SectionCard>

        <SectionCard title="Failed Login Attempts">
          <DataTable
            columns={[
              { key: "email", header: "Email", render: (f) => f.email || "(unknown)" },
              { key: "ip", header: "IP", render: (f) => <span className="font-mono">{f.ip || "—"}</span> },
              { key: "reason", header: "Reason", render: (f) => f.reason || "—" },
              { key: "when", header: "When", render: (f) => f.createdAt ? new Date(f.createdAt).toLocaleString() : "—" },
            ]}
            rows={failedLogins}
            rowKey={(f) => f.id}
            emptyTitle="No failed logins"
            emptyDescription="Clean slate — no suspicious login activity detected."
          />
        </SectionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Active Incidents">
          <DataTable
            columns={[
              { key: "title", header: "Title", render: (i) => <span className="text-white">{i.title || i.id}</span> },
              {
                key: "severity",
                header: "Severity",
                render: (i) => (
                  <StatusPill
                    status={i.severity}
                    variant={i.severity === "critical" ? "bad" : i.severity === "high" ? "warn" : "neutral"}
                  />
                ),
              },
              { key: "status", header: "Status", render: (i) => <StatusPill status={i.status} /> },
              { key: "when", header: "Opened", render: (i) => i.createdAt ? new Date(i.createdAt).toLocaleDateString() : "—" },
            ]}
            rows={incidents}
            rowKey={(i) => i.id}
            emptyTitle="No active incidents"
            emptyDescription="All clear — no open security incidents."
          />
        </SectionCard>

        <SectionCard title="Certificates">
          <DataTable
            columns={[
              { key: "domain", header: "Domain", render: (c) => <span className="font-mono text-white">{(c as any).domain || (c as any).cn || c.id}</span> },
              { key: "status", header: "Status", render: (c) => <StatusPill status={(c as any).status || "active"} /> },
              {
                key: "expires",
                header: "Expires",
                render: (c) => {
                  const exp = (c as any).expiresAt ?? (c as any).expiresat;
                  if (!exp) return "—";
                  const days = Math.ceil((new Date(exp).getTime() - Date.now()) / 86_400_000);
                  const cls = days <= 14 ? "text-rose-400" : days <= 30 ? "text-amber-400" : "text-slate-400";
                  return <span className={`font-mono text-[11px] ${cls}`}>{new Date(exp).toLocaleDateString()}</span>;
                },
              },
            ]}
            rows={certs}
            rowKey={(c) => c.id}
            emptyTitle="No certificates found"
          />
        </SectionCard>
      </div>
    </ConsolePageShell>
  );
}
