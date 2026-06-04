import { redirect } from "next/navigation";
import { getSession } from "../lib/auth";
import { loadTeamData } from "../lib/modules/team";
import { ConsolePageShell } from "../components/ConsolePageShell";
import { SectionCard } from "../components/SectionCard";
import { DataTable, StatusPill } from "../components/DataTable";
import { StatsRow } from "../components/StatsRow";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const session = await getSession();
  if (!session) redirect("/console/login");
  const { users, roles } = await loadTeamData();

  const activeUsers = users.filter((u) => u.isActive).length;
  const today = users.filter((u) => {
    if (!u.lastLoginAt) return false;
    return new Date(u.lastLoginAt).toDateString() === new Date().toDateString();
  }).length;

  return (
    <ConsolePageShell
      session={session}
      activePath="/console/team"
      title="Team"
      subtitle={`${users.length} member(s) · ${roles.length} role(s)`}
    >
      <StatsRow
        stats={[
          { label: "Team Members", value: users.length },
          { label: "Active", value: activeUsers, accent: "ok" },
          { label: "Roles Defined", value: roles.length },
          { label: "Logged In Today", value: today, sub: "active sessions today" },
        ]}
      />

      <SectionCard title="Team Members">
        <DataTable
          columns={[
            { key: "name", header: "Name", render: (u) => <span className="font-medium text-white">{u.name}</span> },
            { key: "email", header: "Email", render: (u) => <span className="font-mono text-slate-300">{u.email}</span> },
            { key: "role", header: "Role", render: (u) => <span className="text-slate-200">{u.role}</span> },
            {
              key: "last",
              header: "Last Login",
              render: (u) => {
                if (!u.lastLoginAt) return <span className="text-slate-600">Never</span>;
                const d = new Date(u.lastLoginAt);
                const isToday = d.toDateString() === new Date().toDateString();
                return (
                  <span className={isToday ? "text-emerald-400" : "text-slate-400"}>
                    {d.toLocaleString()}
                  </span>
                );
              },
            },
            { key: "status", header: "Status", render: (u) => <StatusPill status={u.isActive ? "active" : "paused"} /> },
          ]}
          rows={users}
          rowKey={(u) => u.id}
          emptyTitle="No team members yet"
          emptyDescription="Add team members to delegate console access."
        />
      </SectionCard>

      <SectionCard title="Roles">
        <DataTable
          columns={[
            { key: "name", header: "Name", render: (r) => <span className="font-semibold text-white">{r.name}</span> },
            { key: "desc", header: "Description", render: (r) => <span className="text-slate-400">{r.description || "—"}</span> },
          ]}
          rows={roles}
          rowKey={(r) => r.id}
          emptyTitle="No roles defined"
        />
      </SectionCard>
    </ConsolePageShell>
  );
}
