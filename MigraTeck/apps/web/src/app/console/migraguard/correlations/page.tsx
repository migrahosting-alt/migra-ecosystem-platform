import { redirect } from "next/navigation";
import { CircleOff, Network, GitMerge } from "lucide-react";
import { ConsolePageShell } from "../../components/ConsolePageShell";
import { getSession, verifyEmail } from "../../lib/auth";
import { loadGuardOperatorSnapshot } from "../../lib/migraguard/data";
import { GuardNav } from "../GuardNav";
import { RefreshAlerts } from "../RefreshAlerts";
import { Timestamp } from "../GuardView";

export const dynamic="force-dynamic";

export default async function CorrelationsPage(){
  const session=await getSession();
  if(!session)redirect("/console/login");
  if(!verifyEmail(session.email))redirect("/unauthorized");
  const result=await loadGuardOperatorSnapshot();
  if(result.state==="forbidden")redirect("/unauthorized");
  const data=result.state==="ready"?result.data.correlations:null;
  return <ConsolePageShell session={session} activePath="/console/migraguard" title="Correlation Engine" subtitle="Cross-event patterns and rule effectiveness" actions={<RefreshAlerts/>}>
    <GuardNav/>
    {!data?<section className="rounded-md border border-rose-400/20 p-6"><div className="flex gap-3"><CircleOff size={20} className="text-rose-300"/><p className="text-sm text-slate-300">Correlation authority unavailable.</p></div></section>:
    <>
      <section className="grid gap-px overflow-hidden rounded-md border border-white/10 bg-white/10 sm:grid-cols-4">
        <div className="bg-slate-950 p-4"><p className="text-xs text-slate-500">Rules</p><p className="mt-2 text-3xl font-semibold text-white">{data.rules.length}</p></div>
        <div className="bg-slate-950 p-4"><p className="text-xs text-slate-500">Enabled</p><p className="mt-2 text-3xl font-semibold text-emerald-300">{data.rules.filter(r=>r.enabled).length}</p></div>
        <div className="bg-slate-950 p-4"><p className="text-xs text-slate-500">Detections</p><p className="mt-2 text-3xl font-semibold text-white">{data.detections.length}</p></div>
        <div className="bg-slate-950 p-4"><p className="text-xs text-slate-500">Incident-linked</p><p className="mt-2 text-3xl font-semibold text-amber-200">{data.detections.filter(d=>d.incidentId).length}</p></div>
      </section>
      <section className="overflow-hidden rounded-md border border-white/10">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3"><GitMerge size={17} className="text-fuchsia-300"/><h2 className="text-sm font-semibold text-white">Detected correlations</h2></div>
        {data.detections.length===0?<p className="p-6 text-sm text-slate-400">No detected correlations are present in the bounded operator view.</p>:<div className="overflow-x-auto"><table className="min-w-[980px] w-full text-left text-xs"><thead className="border-b border-white/10 text-[10px] uppercase text-slate-500"><tr><th className="px-4 py-2.5">Rule</th><th className="px-3 py-2.5">Severity</th><th className="px-3 py-2.5">Events</th><th className="px-3 py-2.5">Incident</th><th className="px-3 py-2.5">Description</th><th className="px-4 py-2.5 text-right">Detected</th></tr></thead><tbody className="divide-y divide-white/10">{data.detections.map(row=><tr key={row.id}><td className="px-4 py-3 font-medium text-white">{row.ruleName}</td><td className="px-3 py-3 capitalize text-slate-300">{row.severity}</td><td className="px-3 py-3 text-slate-300">{row.eventCount}</td><td className="px-3 py-3 font-mono text-[10px] text-slate-500">{row.incidentId||"—"}</td><td className="max-w-md px-3 py-3 text-slate-400">{row.description||"—"}</td><td className="px-4 py-3 text-right"><Timestamp value={row.detectedAt}/></td></tr>)}</tbody></table></div>}
      </section>
      <section className="overflow-hidden rounded-md border border-white/10">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3"><Network size={17} className="text-sky-300"/><h2 className="text-sm font-semibold text-white">Correlation rules</h2></div>
        <div className="grid gap-px bg-white/10 md:grid-cols-2">{data.rules.map(row=><article key={row.id} className="bg-slate-950 p-4"><div className="flex items-center justify-between gap-3"><h3 className="font-medium text-white">{row.name}</h3><span className={row.enabled?"text-[10px] uppercase text-emerald-300":"text-[10px] uppercase text-slate-500"}>{row.enabled?"enabled":"disabled"}</span></div><p className="mt-2 text-xs leading-5 text-slate-400">{row.description||"No description"}</p><p className="mt-3 text-[11px] text-slate-500">{row.severity} · {row.timeWindowMinutes} minute window</p></article>)}</div>
      </section>
    </>}
  </ConsolePageShell>;
}
