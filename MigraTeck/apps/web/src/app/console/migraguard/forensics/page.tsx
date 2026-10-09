import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleOff, FileSearch, LockKeyhole } from "lucide-react";
import { ConsolePageShell } from "../../components/ConsolePageShell";
import { getSession, verifyEmail } from "../../lib/auth";
import { loadGuardOperatorSnapshot } from "../../lib/migraguard/data";
import { GuardNav } from "../GuardNav";
import { RefreshAlerts } from "../RefreshAlerts";
import { Timestamp } from "../GuardView";

export const dynamic="force-dynamic";

export default async function ForensicsPage(){
  const session=await getSession();
  if(!session)redirect("/console/login");
  if(!verifyEmail(session.email))redirect("/unauthorized");
  const result=await loadGuardOperatorSnapshot();
  if(result.state==="forbidden")redirect("/unauthorized");
  const data=result.state==="ready"?result.data.forensics:null;
  return <ConsolePageShell session={session} activePath="/console/migraguard" title="Forensics" subtitle="Incident evidence linkage and case readiness" actions={<RefreshAlerts/>}>
    <GuardNav/>
    {!data?<section className="rounded-md border border-rose-400/20 p-6"><div className="flex gap-3"><CircleOff size={20} className="text-rose-300"/><p className="text-sm text-slate-300">Forensic read model unavailable.</p></div></section>:
    <>
      <section className="rounded-md border border-amber-400/20 bg-amber-500/[0.04] p-5"><div className="flex gap-3"><LockKeyhole size={20} className="text-amber-200"/><div><h2 className="font-semibold text-white">Evidence export not yet qualified</h2><p className="mt-1 text-sm text-slate-400">Case evidence counts are authoritative. Immutable bundle export and signed chain-of-custody manifests remain disabled until the evidence-store contract is implemented.</p></div></div></section>
      <section className="grid gap-px overflow-hidden rounded-md border border-white/10 bg-white/10 sm:grid-cols-3">
        <div className="bg-slate-950 p-4"><p className="text-xs text-slate-500">Cases</p><p className="mt-2 text-3xl font-semibold text-white">{data.cases.length}</p></div>
        <div className="bg-slate-950 p-4"><p className="text-xs text-slate-500">Linked evidence</p><p className="mt-2 text-3xl font-semibold text-white">{data.cases.reduce((n,c)=>n+c.linkedEventCount,0)}</p></div>
        <div className="bg-slate-950 p-4"><p className="text-xs text-slate-500">Analyst notes</p><p className="mt-2 text-3xl font-semibold text-white">{data.cases.reduce((n,c)=>n+c.noteCount,0)}</p></div>
      </section>
      <section className="overflow-hidden rounded-md border border-white/10">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3"><FileSearch size={17} className="text-fuchsia-300"/><h2 className="text-sm font-semibold text-white">Case evidence index</h2></div>
        {data.cases.length===0?<p className="p-6 text-sm text-slate-400">No incident cases are present.</p>:<div className="overflow-x-auto"><table className="min-w-[940px] w-full text-left text-xs"><thead className="border-b border-white/10 text-[10px] uppercase text-slate-500"><tr><th className="px-4 py-2.5">Case</th><th className="px-3 py-2.5">Severity</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5">Evidence</th><th className="px-3 py-2.5">Notes</th><th className="px-4 py-2.5 text-right">Latest evidence</th></tr></thead><tbody className="divide-y divide-white/10">{data.cases.map(row=><tr key={row.incidentId}><td className="px-4 py-3"><Link href={`/console/migraguard/forensics/${row.incidentId}`} prefetch={false} className="font-medium text-white hover:text-fuchsia-200 hover:underline">{row.title}</Link><p className="mt-1 font-mono text-[10px] text-slate-600">{row.incidentId}</p></td><td className="px-3 py-3 capitalize text-slate-300">{row.severity}</td><td className="px-3 py-3 capitalize text-slate-300">{row.status}</td><td className="px-3 py-3 text-slate-300">{row.linkedEventCount}</td><td className="px-3 py-3 text-slate-300">{row.noteCount}</td><td className="px-4 py-3 text-right">{row.latestEvidenceAt?<Timestamp value={row.latestEvidenceAt}/>:<span className="text-slate-600">—</span>}</td></tr>)}</tbody></table></div>}
      </section>
    </>}
  </ConsolePageShell>;
}
