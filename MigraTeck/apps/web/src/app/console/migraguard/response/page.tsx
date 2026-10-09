import { redirect } from "next/navigation";
import { CircleOff, Gavel, LockKeyhole } from "lucide-react";
import { ConsolePageShell } from "../../components/ConsolePageShell";
import { getSession, verifyEmail } from "../../lib/auth";
import { loadGuardCommandCenter } from "../../lib/migraguard/data";
import { GuardNav } from "../GuardNav";
import { RefreshAlerts } from "../RefreshAlerts";
import { Timestamp } from "../GuardView";

export const dynamic="force-dynamic";

export default async function ResponsePage(){
  const session=await getSession();
  if(!session)redirect("/console/login");
  if(!verifyEmail(session.email))redirect("/unauthorized");
  const result=await loadGuardCommandCenter();
  if(result.state==="forbidden")redirect("/unauthorized");
  return <ConsolePageShell session={session} activePath="/console/migraguard" title="Response Authority" subtitle="Fail-closed execution governance and provenance" actions={<RefreshAlerts/>}>
    <GuardNav/>
    {result.state!=="ready"||result.data.response.authority!=="governed"?<section className="rounded-md border border-amber-400/20 p-6"><div className="flex gap-3"><CircleOff className="text-amber-200" size={20}/><p className="text-sm text-slate-300">Governed execution authority is unavailable. No execution state is inferred.</p></div></section>:
    <>
      <section className="rounded-md border border-amber-400/20 bg-amber-500/[0.04] p-5"><div className="flex gap-3"><LockKeyhole size={20} className="text-amber-200"/><div><h2 className="font-semibold text-white">Executor intentionally disabled</h2><p className="mt-1 text-sm text-slate-400">The console exposes requests, approvals, capabilities and receipts only. Automatic remediation remains off and there is no execute primitive.</p></div></div></section>
      <section className="grid gap-px overflow-hidden rounded-md border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-5">
        {[["Pending approvals",result.data.response.pendingApprovals],["Active capabilities",result.data.response.capabilities.active],["Consumed capabilities",result.data.response.capabilities.consumed],["Succeeded receipts",result.data.response.receipts.succeeded],["Failed receipts",result.data.response.receipts.failed]].map(([label,value])=><div key={String(label)} className="bg-slate-950 p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold text-white">{value}</p></div>)}
      </section>
      <section className="overflow-hidden rounded-md border border-white/10">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3"><Gavel size={17} className="text-fuchsia-300"/><h2 className="text-sm font-semibold text-white">Execution request ledger</h2></div>
        {result.data.response.requests.length===0?<p className="p-6 text-sm text-slate-400">No execution requests are present.</p>:<div className="overflow-x-auto"><table className="min-w-[960px] w-full text-left text-xs"><thead className="border-b border-white/10 text-[10px] uppercase text-slate-500"><tr><th className="px-4 py-2.5">Target</th><th className="px-3 py-2.5">Policy</th><th className="px-3 py-2.5">Impact</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5">Approvals</th><th className="px-4 py-2.5 text-right">Created</th></tr></thead><tbody className="divide-y divide-white/10">{result.data.response.requests.map(row=><tr key={row.id}><td className="px-4 py-3 font-medium text-white">{row.target}</td><td className="px-3 py-3 text-slate-400">{row.policy}</td><td className="px-3 py-3 capitalize text-slate-300">{row.impactClass}</td><td className="px-3 py-3 capitalize text-slate-300">{row.status}</td><td className="px-3 py-3 text-slate-300">{row.approvalCount}/{row.requiredApprovals}</td><td className="px-4 py-3 text-right"><Timestamp value={row.createdAt}/></td></tr>)}</tbody></table></div>}
      </section>
    </>}
  </ConsolePageShell>;
}
