import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleOff, Server } from "lucide-react";
import { ConsolePageShell } from "../../components/ConsolePageShell";
import { getSession, verifyEmail } from "../../lib/auth";
import { loadGuardCommandCenter } from "../../lib/migraguard/data";
import { GuardNav } from "../GuardNav";
import { RefreshAlerts } from "../RefreshAlerts";
import { Timestamp } from "../GuardView";

export const dynamic="force-dynamic";

export default async function AssetsPage(){
  const session=await getSession();
  if(!session)redirect("/console/login");
  if(!verifyEmail(session.email))redirect("/unauthorized");
  const result=await loadGuardCommandCenter();
  if(result.state==="forbidden")redirect("/unauthorized");
  return <ConsolePageShell session={session} activePath="/console/migraguard" title="Asset Security" subtitle="Authoritative inventory joined to current evidence" actions={<RefreshAlerts/>}>
    <GuardNav/>
    {result.state!=="ready"?<section className="rounded-md border border-rose-400/20 p-6"><div className="flex gap-3"><CircleOff className="text-rose-300" size={20}/><p className="text-sm text-slate-300">Asset authority unavailable. No inventory state is inferred.</p></div></section>:
    <>
      <section className="grid gap-px overflow-hidden rounded-md border border-white/10 bg-white/10 sm:grid-cols-4">
        {[["Inventory",result.data.assets.authoritative?String(result.data.assets.total):"—"],["Reporting",String(result.data.assets.reporting)],["Degraded",String(result.data.assets.degraded)],["No recent evidence",String(result.data.assets.offline)]].map(([label,value])=><div key={label} className="bg-slate-950 p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold text-white">{value}</p></div>)}
      </section>
      <section className="overflow-hidden rounded-md border border-white/10">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3"><Server size={17} className="text-sky-300"/><h2 className="text-sm font-semibold text-white">Protected ecosystem assets</h2></div>
        <div className="overflow-x-auto"><table className="min-w-[980px] w-full text-left text-xs"><thead className="border-b border-white/10 text-[10px] uppercase text-slate-500"><tr><th className="px-4 py-2.5">Asset</th><th className="px-3 py-2.5">Type</th><th className="px-3 py-2.5">IP</th><th className="px-3 py-2.5 text-right">Risk</th><th className="px-3 py-2.5 text-right">24h evidence</th><th className="px-4 py-2.5 text-right">Last evidence</th></tr></thead><tbody className="divide-y divide-white/10">{result.data.assets.rows.map(asset=><tr key={asset.inventoryId||asset.name}><td className="px-4 py-3">{asset.inventoryId?<Link href={"/console/migraguard/assets/"+asset.inventoryId} className="font-medium text-white hover:text-sky-300">{asset.name}</Link>:<p className="font-medium text-white">{asset.name}</p>}<p className="mt-1 text-[10px] text-slate-600">{asset.inventoryId||"evidence-derived"}</p></td><td className="px-3 py-3 text-slate-400">{asset.type||"—"}</td><td className="px-3 py-3 font-mono text-[11px] text-slate-400">{asset.ipAddress||"—"}</td><td className="px-3 py-3 text-right text-slate-300">{asset.riskScore??"—"}</td><td className="px-3 py-3 text-right text-slate-300">{asset.evidence24h}</td><td className="px-4 py-3 text-right">{asset.lastEvidenceAt?<Timestamp value={asset.lastEvidenceAt}/>:<span className="text-slate-600">None</span>}</td></tr>)}</tbody></table></div>
      </section>
    </>}
  </ConsolePageShell>;
}
