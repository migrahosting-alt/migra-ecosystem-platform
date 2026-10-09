import { redirect } from "next/navigation";
import { CircleOff, History } from "lucide-react";
import { ConsolePageShell } from "../../components/ConsolePageShell";
import { getSession, verifyEmail } from "../../lib/auth";
import { loadGuardCommandCenter } from "../../lib/migraguard/data";
import { GuardNav } from "../GuardNav";
import { RefreshAlerts } from "../RefreshAlerts";
import { Timestamp } from "../GuardView";

export const dynamic="force-dynamic";

export default async function AuditPage(){
  const session=await getSession();
  if(!session)redirect("/console/login");
  if(!verifyEmail(session.email))redirect("/unauthorized");
  const result=await loadGuardCommandCenter();
  if(result.state==="forbidden")redirect("/unauthorized");
  return <ConsolePageShell session={session} activePath="/console/migraguard" title="Security Audit" subtitle="Append-only control-plane provenance" actions={<RefreshAlerts/>}>
    <GuardNav/>
    {result.state!=="ready"||!result.data.audit.connected?<section className="rounded-md border border-white/10 p-6"><div className="flex gap-3"><CircleOff size={20} className="text-slate-400"/><p className="text-sm text-slate-300">Append-only audit authority is not connected.</p></div></section>:
    <section className="overflow-hidden rounded-md border border-white/10">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3"><div className="flex items-center gap-2"><History size={17} className="text-fuchsia-300"/><h2 className="text-sm font-semibold text-white">Control-plane audit trail</h2></div><span className="text-xs text-slate-500">{result.data.audit.events.length} records loaded</span></div>
      {result.data.audit.events.length===0?<p className="p-6 text-sm text-slate-400">No audit records are present in the bounded response.</p>:<div className="overflow-x-auto"><table className="min-w-[980px] w-full text-left text-xs"><thead className="border-b border-white/10 text-[10px] uppercase text-slate-500"><tr><th className="px-4 py-2.5">Actor</th><th className="px-3 py-2.5">Action</th><th className="px-3 py-2.5">Target</th><th className="px-3 py-2.5">Outcome</th><th className="px-4 py-2.5 text-right">Time</th></tr></thead><tbody className="divide-y divide-white/10">{result.data.audit.events.map(row=><tr key={row.id}><td className="px-4 py-3"><p className="text-slate-300">{row.actorType}</p><p className="mt-1 font-mono text-[10px] text-slate-600">{row.actorId||"server"}</p></td><td className="px-3 py-3 text-white">{row.action}</td><td className="px-3 py-3 text-slate-400">{row.target}</td><td className="px-3 py-3 capitalize text-slate-300">{row.outcome}</td><td className="px-4 py-3 text-right"><Timestamp value={row.createdAt}/></td></tr>)}</tbody></table></div>}
    </section>}
  </ConsolePageShell>;
}
