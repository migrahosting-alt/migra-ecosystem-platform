import Link from "next/link";
import type { ClientAccount } from "../lib/clients";

const STATUS_PILL: Record<ClientAccount["status"], string> = {
  active: "bg-emerald-500/15 text-emerald-300 border-emerald-400/20",
  paused: "bg-amber-500/15 text-amber-300 border-amber-400/20",
  trial: "bg-blue-500/15 text-blue-300 border-blue-400/20",
  churned: "bg-rose-500/15 text-rose-300 border-rose-400/20",
};

export const ClientsTable = ({ clients }: { clients: ReadonlyArray<ClientAccount> }) => {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-xl shadow-slate-950/30 backdrop-blur">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">Client Accounts / Recent Accounts</h2>
        <Link
          href="/console/clients"
          className="text-[11px] font-medium text-fuchsia-300 hover:text-fuchsia-200"
        >
          View All Clients
        </Link>
      </div>

      {clients.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-xs text-slate-500">
          No clients to display. New tenants will appear here as they sign up.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/5">
          <table className="min-w-full divide-y divide-white/5 text-xs">
            <thead>
              <tr className="bg-white/[0.02] text-left text-[10px] uppercase tracking-wider text-slate-500">
                <th className="px-4 py-2 font-medium">Client / Company</th>
                <th className="px-4 py-2 font-medium">Services</th>
                <th className="px-4 py-2 font-medium">Plan Tier</th>
                <th className="px-4 py-2 font-medium">Account Manager</th>
                <th className="px-4 py-2 font-medium">Last Activity</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {clients.map((c) => (
                <tr key={c.id} className="transition hover:bg-white/[0.02]">
                  <td className="px-4 py-2.5">
                    <p className="font-semibold text-white">{c.name}</p>
                    {c.domain && <p className="text-[10px] text-slate-500">{c.domain}</p>}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-0.5">
                      {c.services.slice(0, 4).map((s) => (
                        <span
                          key={s.id}
                          title={s.id}
                          className={`inline-flex h-5 w-7 items-center justify-center rounded bg-gradient-to-br ${s.accent} text-[9px] font-black text-white shadow`}
                        >
                          {s.shortCode}
                        </span>
                      ))}
                      {c.services.length > 4 && (
                        <span className="text-[10px] text-slate-500">+{c.services.length - 4}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-slate-200">{c.planTier}</td>
                  <td className="px-4 py-2.5 text-slate-200">{c.accountManager}</td>
                  <td className="px-4 py-2.5 text-slate-400">
                    {c.lastActivity ? c.lastActivity.relative : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium capitalize ${STATUS_PILL[c.status]}`}
                    >
                      {c.status}
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
