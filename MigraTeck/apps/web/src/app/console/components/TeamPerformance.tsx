import Link from "next/link";

export type TeamMember = {
  id: string;
  name: string;
  role: string;
  avatarUrl?: string | null;
  activeTasks: number;
  workloadPct: number;
  status: "available" | "busy" | "away" | "offline";
};

const STATUS_DOT: Record<TeamMember["status"], string> = {
  available: "bg-emerald-400",
  busy: "bg-amber-400",
  away: "bg-slate-500",
  offline: "bg-slate-700",
};

export const TeamPerformance = ({ members }: { members: ReadonlyArray<TeamMember> }) => {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-xl shadow-slate-950/30 backdrop-blur">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">Team Performance</h2>
        <Link
          href="/console/team"
          className="text-[11px] font-medium text-fuchsia-300 hover:text-fuchsia-200"
        >
          View Team
        </Link>
      </div>

      {members.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-xs text-slate-500">
          No team members yet. Add staff in <Link href="/console/team" className="text-fuchsia-300 underline">Team settings</Link>.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/5">
          <table className="min-w-full divide-y divide-white/5 text-xs">
            <thead>
              <tr className="bg-white/[0.02] text-left text-[10px] uppercase tracking-wider text-slate-500">
                <th className="px-4 py-2 font-medium">Team Member</th>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-4 py-2 font-medium">Active Tasks</th>
                <th className="px-4 py-2 font-medium">Workload</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {members.map((m) => (
                <tr key={m.id} className="transition hover:bg-white/[0.02]">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-fuchsia-400 text-[10px] font-bold text-white">
                        {m.name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase()}
                      </span>
                      <span className="font-semibold text-white">{m.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-slate-300">{m.role}</td>
                  <td className="px-4 py-2.5 text-slate-300">{m.activeTasks}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/5">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 to-purple-500"
                          style={{ width: `${m.workloadPct}%` }}
                        />
                      </div>
                      <span className="font-mono text-[10px] text-slate-400">{m.workloadPct}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5 text-[11px] capitalize text-slate-300">
                      <span className={`h-2 w-2 rounded-full ${STATUS_DOT[m.status]}`} />
                      {m.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
