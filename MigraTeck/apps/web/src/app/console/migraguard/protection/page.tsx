import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleOff, ShieldAlert, LockKeyhole } from "lucide-react";
import { ConsolePageShell } from "../../components/ConsolePageShell";
import { getSession, verifyEmail } from "../../lib/auth";
import { loadGuardOperatorSnapshot } from "../../lib/migraguard/data";
import { isGuardOperatorFederationConfigured } from "../../lib/migraguard/operator-actions";
import { GuardNav } from "../GuardNav";
import { RefreshAlerts } from "../RefreshAlerts";
import { Timestamp } from "../GuardView";
import { ProtectionAlertAction } from "./ProtectionAlertAction";

export const dynamic="force-dynamic";

export default async function ProtectionPage(){
  const session=await getSession();
  if(!session)redirect("/console/login");
  if(!verifyEmail(session.email))redirect("/unauthorized");
  const result=await loadGuardOperatorSnapshot();
  if(result.state==="forbidden")redirect("/unauthorized");
  const alerts=result.state==="ready"?result.data.protectionAlerts:null;
  const operatorActionsEnabled=isGuardOperatorFederationConfigured();
  const playbooks=result.state==="ready"?(result.data.policyPosture?.playbooks||[]):[];
  return <ConsolePageShell session={session} activePath="/console/migraguard" title="Protection Decisions" subtitle="Immutable detector decisions and response provenance" actions={<RefreshAlerts/>}>
    <GuardNav/>
    {!alerts?<section className="rounded-md border border-rose-400/20 p-6"><div className="flex gap-3"><CircleOff size={20} className="text-rose-300"/><p className="text-sm text-slate-300">Protection-decision authority unavailable.</p></div></section>:
    <>
      <section className="grid gap-px overflow-hidden rounded-md border border-white/10 bg-white/10 sm:grid-cols-4">
        <div className="bg-slate-950 p-4"><p className="text-xs text-slate-500">Protection alerts</p><p className="mt-2 text-3xl font-semibold text-white">{alerts.length}</p></div>
        <div className="bg-slate-950 p-4"><p className="text-xs text-slate-500">Critical</p><p className="mt-2 text-3xl font-semibold text-rose-300">{alerts.filter(a=>a.severity==="critical").length}</p></div>
        <div className="bg-slate-950 p-4"><p className="text-xs text-slate-500">Incident-linked</p><p className="mt-2 text-3xl font-semibold text-white">{alerts.filter(a=>a.correlatedIncidentId).length}</p></div>
        <div className="bg-slate-950 p-4"><p className="text-xs text-slate-500">Response requested</p><p className="mt-2 text-3xl font-semibold text-amber-200">{alerts.filter(a=>a.executionRequestId).length}</p></div>
      </section>
      <section className="rounded-md border border-amber-400/20 bg-amber-500/[0.04] p-4"><div className="flex gap-3"><LockKeyhole size={18} className="text-amber-200"/><p className="text-sm text-slate-300">Viewing remains provenance-only. Explicit acknowledgement is separately signed and audited; it still does not create an approval, capability, or execution.</p></div></section>
      <section className="overflow-hidden rounded-md border border-white/10">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3"><ShieldAlert size={17} className="text-rose-300"/><h2 className="text-sm font-semibold text-white">Immutable protection ledger</h2></div>
        {alerts.length===0?<p className="p-6 text-sm text-slate-400">No immutable protection decisions are present.</p>:<div className="overflow-x-auto"><table className="min-w-[1100px] w-full text-left text-xs"><thead className="border-b border-white/10 text-[10px] uppercase text-slate-500"><tr><th className="px-4 py-2.5">Decision</th><th className="px-3 py-2.5">Severity</th><th className="px-3 py-2.5">Evidence</th><th className="px-3 py-2.5">Incident</th><th className="px-3 py-2.5">Response</th><th className="px-3 py-2.5">Approvals</th><th className="px-3 py-2.5">Operator</th><th className="px-4 py-2.5 text-right">Time</th></tr></thead><tbody className="divide-y divide-white/10">{alerts.map(row=><tr key={row.id}><td className="px-4 py-3"><p className="font-medium text-white">{row.title}</p><p className="mt-1 text-[10px] text-slate-600">{row.detectorId} · policy v{row.policyVersion}</p></td><td className="px-3 py-3 capitalize text-slate-300">{row.severity}</td><td className="px-3 py-3"><p className="text-slate-300">{row.eventType.replaceAll("."," · ").replaceAll("_"," ")}</p><p className="mt-1 text-[10px] text-slate-600">{row.attackCategory.replaceAll("_"," ")}</p></td><td className="px-3 py-3">{row.correlatedIncidentId?<Link href={"/console/migraguard/incidents/"+row.correlatedIncidentId} className="font-mono text-[10px] text-sky-300 hover:underline">{row.correlatedIncidentId}</Link>:<span className="text-slate-600">—</span>}</td><td className="px-3 py-3 capitalize text-slate-300">{(row.responseStatus||"none").replaceAll("_"," ")}</td><td className="px-3 py-3 text-slate-300">{row.executionRequestId?String(row.approvalCount)+"/"+String(row.requiredApprovals):"—"}</td><td className="px-3 py-3"><ProtectionAlertAction alertId={row.id} agentId={row.agentId} executionRequestId={row.executionRequestId} playbooks={playbooks} enabled={operatorActionsEnabled}/></td><td className="px-4 py-3 text-right"><Timestamp value={row.createdAt}/></td></tr>)}</tbody></table></div>}
      </section>
    </>}
  </ConsolePageShell>;
}
