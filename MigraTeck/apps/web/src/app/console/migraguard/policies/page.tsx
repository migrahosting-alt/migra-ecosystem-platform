import { redirect } from "next/navigation";
import { CircleOff, LockKeyhole, ScanLine, Workflow } from "lucide-react";
import { ConsolePageShell } from "../../components/ConsolePageShell";
import { getSession, verifyEmail } from "../../lib/auth";
import { loadGuardOperatorSnapshot } from "../../lib/migraguard/data";
import { GuardNav } from "../GuardNav";
import { RefreshAlerts } from "../RefreshAlerts";
import { Timestamp } from "../GuardView";

export const dynamic="force-dynamic";

export default async function PoliciesPage(){
  const session=await getSession();
  if(!session)redirect("/console/login");
  if(!verifyEmail(session.email))redirect("/unauthorized");
  const result=await loadGuardOperatorSnapshot();
  if(result.state==="forbidden")redirect("/unauthorized");
  const data=result.state==="ready"?result.data.policyPosture:null;
  return <ConsolePageShell session={session} activePath="/console/migraguard" title="Security Policies" subtitle="Detection policy and workflow posture" actions={<RefreshAlerts/>}>
    <GuardNav/>
    {!data?<section className="rounded-md border border-rose-400/20 p-6"><div className="flex gap-3"><CircleOff size={20} className="text-rose-300"/><p className="text-sm text-slate-300">Policy authority unavailable.</p></div></section>:
    <>
      <section className="rounded-md border border-amber-400/20 bg-amber-500/[0.04] p-5"><div className="flex gap-3"><LockKeyhole size={20} className="text-amber-200"/><div><h2 className="font-semibold text-white">Policy mutation intentionally disabled</h2><p className="mt-1 text-sm text-slate-400">This console can inspect policy and workflow posture. It cannot edit rules, workflow steps, or trigger execution.</p></div></div></section>
      <section className="grid gap-px overflow-hidden rounded-md border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Policies",data.policies.length],
          ["Enabled policies",data.policies.filter(p=>p.enabled).length],
          ["Workflows",data.workflows.length],
          ["Workflow runs",data.workflowExecutions.total],
          ["Workflow failures",data.workflowExecutions.failed],
        ].map(([label,value])=><div key={String(label)} className="bg-slate-950 p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold text-white">{value}</p></div>)}
      </section>
      <section className="overflow-hidden rounded-md border border-white/10">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3"><ScanLine size={17} className="text-sky-300"/><h2 className="text-sm font-semibold text-white">Policies</h2></div>
        {data.policies.length===0?<p className="p-6 text-sm text-slate-400">No policies are present.</p>:<div className="grid gap-px bg-white/10 md:grid-cols-2">{data.policies.map(row=><article key={row.id} className="bg-slate-950 p-4"><div className="flex items-center justify-between gap-3"><h3 className="font-medium text-white">{row.name}</h3><span className={row.enabled?"text-[10px] uppercase text-emerald-300":"text-[10px] uppercase text-slate-500"}>{row.enabled?"enabled":"disabled"}</span></div><p className="mt-2 text-xs text-slate-400">{row.description||"No description"}</p><div className="mt-3 flex flex-wrap gap-3 text-[11px] text-slate-500"><span>{row.type}</span><span>priority {row.priority}</span>{row.lastTriggeredAt&&<span>last triggered <Timestamp value={row.lastTriggeredAt}/></span>}</div></article>)}</div>}
      </section>
      <section className="overflow-hidden rounded-md border border-white/10">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3"><Workflow size={17} className="text-fuchsia-300"/><h2 className="text-sm font-semibold text-white">Workflows</h2></div>
        <div className="grid gap-px bg-white/10 md:grid-cols-2">{data.workflows.map(row=><article key={row.id} className="bg-slate-950 p-4"><div className="flex items-center justify-between gap-3"><h3 className="font-medium text-white">{row.name}</h3><span className={row.enabled?"text-[10px] uppercase text-emerald-300":"text-[10px] uppercase text-slate-500"}>{row.enabled?"enabled":"disabled"}</span></div><p className="mt-2 text-xs text-slate-400">{row.description||"No description"}</p></article>)}</div>
      </section>
    </>}
  </ConsolePageShell>;
}
