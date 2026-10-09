import { redirect } from "next/navigation";
import { CircleOff, ClipboardCheck } from "lucide-react";
import { ConsolePageShell } from "../../components/ConsolePageShell";
import { getSession, verifyEmail } from "../../lib/auth";
import { loadGuardOperatorSnapshot } from "../../lib/migraguard/data";
import { GuardNav } from "../GuardNav";
import { RefreshAlerts } from "../RefreshAlerts";
import { Timestamp } from "../GuardView";

export const dynamic="force-dynamic";

export default async function CompliancePage(){
  const session=await getSession();
  if(!session)redirect("/console/login");
  if(!verifyEmail(session.email))redirect("/unauthorized");
  const result=await loadGuardOperatorSnapshot();
  if(result.state==="forbidden")redirect("/unauthorized");
  const data=result.state==="ready"?result.data.compliance:null;
  return <ConsolePageShell session={session} activePath="/console/migraguard" title="Compliance Posture" subtitle="Framework coverage and assessment status" actions={<RefreshAlerts/>}>
    <GuardNav/>
    {!data?<section className="rounded-md border border-rose-400/20 p-6"><div className="flex gap-3"><CircleOff size={20} className="text-rose-300"/><p className="text-sm text-slate-300">Compliance authority unavailable.</p></div></section>:
    <>
      <section className="grid gap-px overflow-hidden rounded-md border border-white/10 bg-white/10 sm:grid-cols-3">
        <div className="bg-slate-950 p-4"><p className="text-xs text-slate-500">Frameworks</p><p className="mt-2 text-3xl font-semibold text-white">{data.frameworks.length}</p></div>
        <div className="bg-slate-950 p-4"><p className="text-xs text-slate-500">Assessments</p><p className="mt-2 text-3xl font-semibold text-white">{data.assessments.length}</p></div>
        <div className="bg-slate-950 p-4"><p className="text-xs text-slate-500">Completed</p><p className="mt-2 text-3xl font-semibold text-emerald-300">{data.assessments.filter(a=>a.status.toLowerCase()==="completed").length}</p></div>
      </section>
      <section className="grid gap-4 lg:grid-cols-2">{data.frameworks.map(row=><article key={row.id} className="rounded-md border border-white/10 p-4"><div className="flex items-start justify-between gap-3"><div><h2 className="font-medium text-white">{row.name}</h2><p className="mt-1 text-xs text-slate-500">{row.version||"Unversioned"}</p></div><span className="text-sm font-semibold text-sky-300">{row.controlCount} controls</span></div><p className="mt-3 text-sm leading-6 text-slate-400">{row.description||"No framework description provided."}</p></article>)}</section>
      <section className="overflow-hidden rounded-md border border-white/10">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3"><ClipboardCheck size={17} className="text-emerald-300"/><h2 className="text-sm font-semibold text-white">Assessments</h2></div>
        {data.assessments.length===0?<p className="p-6 text-sm text-slate-400">No tenant assessments are present.</p>:<div className="overflow-x-auto"><table className="min-w-[860px] w-full text-left text-xs"><thead className="border-b border-white/10 text-[10px] uppercase text-slate-500"><tr><th className="px-4 py-2.5">Framework</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5">Score</th><th className="px-4 py-2.5 text-right">Assessed</th></tr></thead><tbody className="divide-y divide-white/10">{data.assessments.map(row=><tr key={row.id}><td className="px-4 py-3"><p className="font-medium text-white">{row.frameworkName}</p><p className="mt-1 text-[10px] text-slate-600">{row.frameworkVersion||"—"}</p></td><td className="px-3 py-3 capitalize text-slate-300">{row.status}</td><td className="px-3 py-3 text-slate-300">{row.score??"—"}</td><td className="px-4 py-3 text-right">{row.assessedAt?<Timestamp value={row.assessedAt}/>:<span className="text-slate-600">Not assessed</span>}</td></tr>)}</tbody></table></div>}
      </section>
    </>}
  </ConsolePageShell>;
}
