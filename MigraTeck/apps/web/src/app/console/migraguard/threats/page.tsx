import { redirect } from "next/navigation";
import { Crosshair, CircleOff, Radar } from "lucide-react";
import { ConsolePageShell } from "../../components/ConsolePageShell";
import { getSession, verifyEmail } from "../../lib/auth";
import { loadGuardOperatorSnapshot } from "../../lib/migraguard/data";
import { GuardNav } from "../GuardNav";
import { RefreshAlerts } from "../RefreshAlerts";
import { Timestamp } from "../GuardView";

export const dynamic="force-dynamic";

export default async function ThreatIntelligencePage(){
  const session=await getSession();
  if(!session)redirect("/console/login");
  if(!verifyEmail(session.email))redirect("/unauthorized");
  const result=await loadGuardOperatorSnapshot();
  if(result.state==="forbidden")redirect("/unauthorized");
  const data=result.state==="ready"?result.data.threatIntelligence:null;
  return <ConsolePageShell session={session} activePath="/console/migraguard" title="Threat Intelligence" subtitle="Indicators, attribution context, and source confidence" actions={<RefreshAlerts/>}>
    <GuardNav/>
    {!data?<section className="rounded-md border border-rose-400/20 p-6"><div className="flex gap-3"><CircleOff size={20} className="text-rose-300"/><p className="text-sm text-slate-300">Threat-intelligence authority unavailable. No empty or safe state is inferred.</p></div></section>:
    <>
      <section className="grid gap-px overflow-hidden rounded-md border border-white/10 bg-white/10 sm:grid-cols-3">
        <div className="bg-slate-950 p-4"><p className="text-xs text-slate-500">Indicators</p><p className="mt-2 text-3xl font-semibold text-white">{data.iocs.length}</p></div>
        <div className="bg-slate-950 p-4"><p className="text-xs text-slate-500">Threat actors</p><p className="mt-2 text-3xl font-semibold text-white">{data.threatActors.length}</p></div>
        <div className="bg-slate-950 p-4"><p className="text-xs text-slate-500">High-confidence IOCs</p><p className="mt-2 text-3xl font-semibold text-amber-200">{data.iocs.filter(i=>i.confidence!==null&&i.confidence>=80).length}</p></div>
      </section>
      <section className="overflow-hidden rounded-md border border-white/10">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3"><Crosshair size={17} className="text-rose-300"/><h2 className="text-sm font-semibold text-white">Indicators of compromise</h2></div>
        {data.iocs.length===0?<p className="p-6 text-sm text-slate-400">No IOCs are present in the connected tenant intelligence store.</p>:<div className="overflow-x-auto"><table className="min-w-[980px] w-full text-left text-xs"><thead className="border-b border-white/10 text-[10px] uppercase text-slate-500"><tr><th className="px-4 py-2.5">Indicator</th><th className="px-3 py-2.5">Type</th><th className="px-3 py-2.5">Threat</th><th className="px-3 py-2.5">Confidence</th><th className="px-3 py-2.5">Source</th><th className="px-4 py-2.5 text-right">Last seen</th></tr></thead><tbody className="divide-y divide-white/10">{data.iocs.map(row=><tr key={row.id}><td className="px-4 py-3 font-mono text-[11px] text-white">{row.value}</td><td className="px-3 py-3 text-slate-300">{row.type}</td><td className="px-3 py-3 text-slate-300">{row.threatType||"—"}</td><td className="px-3 py-3 text-slate-300">{row.confidence??"—"}</td><td className="px-3 py-3 text-slate-400">{row.source||"—"}</td><td className="px-4 py-3 text-right">{row.lastSeenAt?<Timestamp value={row.lastSeenAt}/>:<span className="text-slate-600">—</span>}</td></tr>)}</tbody></table></div>}
      </section>
      <section className="overflow-hidden rounded-md border border-white/10">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3"><Radar size={17} className="text-fuchsia-300"/><h2 className="text-sm font-semibold text-white">Threat actors</h2></div>
        {data.threatActors.length===0?<p className="p-6 text-sm text-slate-400">No threat actors are currently represented.</p>:<div className="grid gap-px bg-white/10 md:grid-cols-2">{data.threatActors.map(row=><article key={row.id} className="bg-slate-950 p-4"><div className="flex items-center justify-between gap-3"><h3 className="font-medium text-white">{row.name}</h3><span className="text-[10px] uppercase text-slate-500">{row.sophistication||"unknown"}</span></div><p className="mt-2 text-xs text-slate-500">{row.aliases.length?row.aliases.join(" · "):"No aliases"}</p>{row.lastActivityAt&&<p className="mt-3 text-xs text-slate-400">Last activity <Timestamp value={row.lastActivityAt}/></p>}</article>)}</div>}
      </section>
    </>}
  </ConsolePageShell>;
}
