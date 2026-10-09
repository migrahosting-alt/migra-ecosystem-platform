import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, CircleOff } from "lucide-react";
import { ConsolePageShell } from "../../components/ConsolePageShell";
import { getSession, verifyEmail } from "../../lib/auth";
import { loadGuardCommandCenter } from "../../lib/migraguard/data";
import { GuardNav } from "../GuardNav";
import { RefreshAlerts } from "../RefreshAlerts";
import { Timestamp } from "../GuardView";

export const dynamic="force-dynamic";

export default async function IncidentsPage(){
  const session=await getSession();
  if(!session)redirect("/console/login");
  if(!verifyEmail(session.email))redirect("/unauthorized");
  const result=await loadGuardCommandCenter();
  if(result.state==="forbidden")redirect("/unauthorized");
  return <ConsolePageShell session={session} activePath="/console/migraguard" title="Incident Operations" subtitle="Persisted incident state and investigation queue" actions={<RefreshAlerts/>}>
    <GuardNav/>
    {result.state!=="ready"?<section className="rounded-md border border-rose-400/20 p-6"><div className="flex gap-3"><CircleOff className="text-rose-300" size={20}/><div><h2 className="font-semibold text-white">Incident data unavailable</h2><p className="mt-1 text-sm text-slate-400">No zero-count or all-clear state is inferred.</p></div></div></section>:
    !result.data.incidents.connected?<section className="rounded-md border border-white/10 p-6"><p className="text-sm text-slate-300">Incident authority is not connected.</p></section>:
    <>
      <section className="grid gap-px overflow-hidden rounded-md border border-white/10 bg-white/10 sm:grid-cols-3">
        <div className="bg-slate-950 p-4"><p className="text-xs text-slate-500">Active incidents</p><p className="mt-2 text-3xl font-semibold text-white">{result.data.incidents.active}</p></div>
        <div className="bg-slate-950 p-4"><p className="text-xs text-slate-500">Critical active</p><p className="mt-2 text-3xl font-semibold text-rose-300">{result.data.incidents.critical}</p></div>
        <div className="bg-slate-950 p-4"><p className="text-xs text-slate-500">Persisted records loaded</p><p className="mt-2 text-3xl font-semibold text-white">{result.data.incidents.items.length}</p></div>
      </section>
      <section className="overflow-hidden rounded-md border border-white/10">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3"><AlertTriangle size={17} className="text-amber-200"/><h2 className="text-sm font-semibold text-white">Incident queue</h2></div>
        {result.data.incidents.items.length===0?<p className="p-6 text-sm text-slate-400">The connected incident authority reports no persisted incidents.</p>:<div className="overflow-x-auto"><table className="min-w-[860px] w-full text-left text-xs"><thead className="border-b border-white/10 text-[10px] uppercase text-slate-500"><tr><th className="px-4 py-2.5">Incident</th><th className="px-3 py-2.5">Severity</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5">Source</th><th className="px-4 py-2.5 text-right">Updated</th></tr></thead><tbody className="divide-y divide-white/10">{result.data.incidents.items.map(item=><tr key={item.id}><td className="px-4 py-3"><Link href={`/console/migraguard/incidents/${item.id}`} prefetch={false} className="font-medium text-white hover:text-fuchsia-200 hover:underline">{item.title}</Link><p className="mt-1 font-mono text-[10px] text-slate-600">{item.id}</p></td><td className="px-3 py-3 capitalize text-slate-300">{item.severity}</td><td className="px-3 py-3 capitalize text-slate-300">{item.status}</td><td className="px-3 py-3 text-slate-400">{item.summary}</td><td className="px-4 py-3 text-right">{item.updatedAt||item.openedAt?<Timestamp value={item.updatedAt||item.openedAt!}/>:<span className="text-slate-600">—</span>}</td></tr>)}</tbody></table></div>}
      </section>
    </>}
  </ConsolePageShell>;
}
