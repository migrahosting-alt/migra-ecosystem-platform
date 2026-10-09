import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, Crosshair, GitMerge, LockKeyhole } from "lucide-react";
import { ConsolePageShell } from "../../../components/ConsolePageShell";
import { getSession, verifyEmail } from "../../../lib/auth";
import { loadGuardIncidentDetail } from "../../../lib/migraguard/data";
import { isGuardOperatorFederationConfigured } from "../../../lib/migraguard/operator-actions";
import { GuardNav } from "../../GuardNav";
import { RefreshAlerts } from "../../RefreshAlerts";
import { Timestamp } from "../../GuardView";
import { IncidentOperatorPanel } from "./IncidentOperatorPanel";
import { IncidentNotesPanel } from "./IncidentNotesPanel";

export const dynamic="force-dynamic";

export default async function IncidentDetailPage({params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  const session=await getSession();
  if(!session)redirect("/console/login");
  if(!verifyEmail(session.email))redirect("/unauthorized");
  const result=await loadGuardIncidentDetail(id);
  if(result.state==="forbidden")redirect("/unauthorized");
  if(result.state!=="ready")notFound();
  const data=result.data;
  const operatorActionsEnabled=isGuardOperatorFederationConfigured();
  return <ConsolePageShell session={session} activePath="/console/migraguard" title={data.incident.title} subtitle="Incident evidence, correlation, and governed-response provenance" actions={<RefreshAlerts/>}>
    <GuardNav/>
    <div className="flex"><Link href="/console/migraguard/incidents" className="text-xs text-slate-400 hover:text-white">← Back to incidents</Link></div>
    <section className="rounded-md border border-white/10 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2"><AlertTriangle size={18} className="text-amber-200"/><h2 className="font-semibold text-white">{data.incident.title}</h2></div><p className="mt-2 text-sm text-slate-400">{data.incident.description||"No incident description is available."}</p>{data.incident.hypothesis&&<p className="mt-3 text-xs leading-5 text-slate-500">Hypothesis: {data.incident.hypothesis}</p>}</div><div className="text-right text-xs text-slate-400"><p className="capitalize">{data.incident.severity} · {data.incident.status}</p><p className="mt-1 font-mono text-[10px] text-slate-600">{data.incident.id}</p></div></div>
      <dl className="mt-5 grid gap-px overflow-hidden rounded-md bg-white/10 sm:grid-cols-4"><div className="bg-slate-950 p-3"><dt className="text-[10px] text-slate-500">Canonical events</dt><dd className="mt-1 text-xl font-semibold text-white">{data.events.length}</dd></div><div className="bg-slate-950 p-3"><dt className="text-[10px] text-slate-500">Correlations</dt><dd className="mt-1 text-xl font-semibold text-white">{data.correlations.length}</dd></div><div className="bg-slate-950 p-3"><dt className="text-[10px] text-slate-500">Protection alerts</dt><dd className="mt-1 text-xl font-semibold text-white">{data.protectionAlerts.length}</dd></div><div className="bg-slate-950 p-3"><dt className="text-[10px] text-slate-500">Opened</dt><dd className="mt-1 text-sm font-semibold text-white"><Timestamp value={data.incident.createdAt}/></dd></div></dl>
    </section>
    <IncidentOperatorPanel incidentId={data.incident.id} currentStatus={data.incident.status} currentAssignedTo={data.incident.assignedTo} enabled={operatorActionsEnabled}/>
    <IncidentNotesPanel incidentId={data.incident.id} enabled={operatorActionsEnabled}/>
    <section className="overflow-hidden rounded-md border border-white/10">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3"><Crosshair size={17} className="text-sky-300"/><h2 className="text-sm font-semibold text-white">Canonical evidence</h2></div>
      {data.events.length===0?<p className="p-6 text-sm text-slate-400">No canonical events are explicitly correlated to this incident.</p>:<div className="overflow-x-auto"><table className="min-w-[980px] w-full text-left text-xs"><thead className="border-b border-white/10 text-[10px] uppercase text-slate-500"><tr><th className="px-4 py-2.5">Severity</th><th className="px-3 py-2.5">Event</th><th className="px-3 py-2.5">Host</th><th className="px-3 py-2.5">Category</th><th className="px-3 py-2.5">Action</th><th className="px-4 py-2.5 text-right">Time</th></tr></thead><tbody className="divide-y divide-white/10">{data.events.map(row=><tr key={row.id}><td className="px-4 py-3 capitalize text-slate-300">{row.severity}</td><td className="px-3 py-3 font-medium text-white">{row.eventType.replaceAll("."," · ").replaceAll("_"," ")}</td><td className="px-3 py-3 text-slate-400">{row.hostname||row.host||"—"}</td><td className="px-3 py-3 text-slate-300">{row.attackCategory.replaceAll("_"," ")}</td><td className="px-3 py-3 text-slate-400">{(row.actionTaken||"observed").replaceAll("_"," ")}</td><td className="px-4 py-3 text-right"><Timestamp value={row.timestamp}/></td></tr>)}</tbody></table></div>}
    </section>
    <section className="grid gap-4 xl:grid-cols-2">
      <div className="overflow-hidden rounded-md border border-white/10"><div className="flex items-center gap-2 border-b border-white/10 px-4 py-3"><GitMerge size={17} className="text-fuchsia-300"/><h2 className="text-sm font-semibold text-white">Correlation provenance</h2></div>{data.correlations.length===0?<p className="p-5 text-sm text-slate-400">No correlation records are linked.</p>:<ul className="divide-y divide-white/10">{data.correlations.map(row=><li key={row.id} className="p-4"><div className="flex justify-between gap-3"><span className="font-medium text-white">{row.ruleName}</span><span className="text-xs capitalize text-slate-400">{row.severity}</span></div><p className="mt-2 text-xs text-slate-500">{row.eventCount} linked events · <Timestamp value={row.detectedAt}/></p></li>)}</ul>}</div>
      <div className="overflow-hidden rounded-md border border-white/10"><div className="flex items-center gap-2 border-b border-white/10 px-4 py-3"><LockKeyhole size={17} className="text-amber-200"/><h2 className="text-sm font-semibold text-white">Governed response linkage</h2></div>{data.protectionAlerts.length===0?<p className="p-5 text-sm text-slate-400">No protection alert / execution-request provenance is linked.</p>:<ul className="divide-y divide-white/10">{data.protectionAlerts.map(row=><li key={row.id} className="p-4"><div className="flex justify-between gap-3"><span className="font-medium text-white">{row.title}</span><span className="text-xs capitalize text-slate-400">{(row.responseStatus||"no response request").replaceAll("_"," ")}</span></div><p className="mt-2 text-xs text-slate-500">{row.detectorId} · policy v{row.policyVersion}</p>{row.executionRequestId&&<p className="mt-2 text-xs text-slate-400">Approvals {row.approvalCount}/{row.requiredApprovals} · {row.impactClass||"unknown"} impact</p>}</li>)}</ul>}</div>
    </section>
  </ConsolePageShell>;
}
