import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Fingerprint, LockKeyhole, ShieldCheck, GitMerge, FileSearch } from "lucide-react";
import { ConsolePageShell } from "../../../components/ConsolePageShell";
import { getSession, verifyEmail } from "../../../lib/auth";
import { loadGuardForensicManifest } from "../../../lib/migraguard/data";
import { GuardNav } from "../../GuardNav";
import { RefreshAlerts } from "../../RefreshAlerts";
import { Timestamp } from "../../GuardView";

export const dynamic="force-dynamic";

export default async function ForensicManifestPage({params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  const session=await getSession();
  if(!session)redirect("/console/login");
  if(!verifyEmail(session.email))redirect("/unauthorized");
  const result=await loadGuardForensicManifest(id);
  if(result.state==="forbidden")redirect("/unauthorized");
  if(result.state!=="ready")notFound();
  const data=result.data;

  return <ConsolePageShell session={session} activePath="/console/migraguard" title="Forensic Manifest" subtitle="Deterministic evidence fingerprint and case provenance" actions={<RefreshAlerts/>}>
    <GuardNav/>
    <div className="flex"><Link href="/console/migraguard/forensics" className="text-xs text-slate-400 hover:text-white">← Back to forensics</Link></div>

    <section className="rounded-md border border-amber-400/20 bg-amber-500/[0.04] p-5">
      <div className="flex gap-3"><LockKeyhole size={20} className="mt-0.5 text-amber-200"/><div><h2 className="font-semibold text-white">Integrity fingerprint — not signed chain of custody</h2><p className="mt-1 text-sm leading-6 text-slate-400">This manifest fingerprints the current authoritative rows. It is not immutable, not signed, not chain-of-custody qualified, and cannot be exported from this console.</p></div></div>
    </section>

    <section className="rounded-md border border-white/10 p-5">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div><div className="flex items-center gap-2"><FileSearch size={18} className="text-fuchsia-300"/><h2 className="font-semibold text-white">{data.incident.title}</h2></div><p className="mt-2 text-sm text-slate-400">{data.incident.source||"unknown source"} · {data.incident.node||"unknown node"} · <span className="capitalize">{data.incident.severity}</span> · <span className="capitalize">{data.incident.status}</span></p><p className="mt-2 font-mono text-[10px] text-slate-600">{data.incident.id}</p></div>
        <div className="text-right text-xs text-slate-500"><p>Manifest v{data.schemaVersion}</p><p className="mt-1">Generated <Timestamp value={data.generatedAt}/></p></div>
      </div>
      <div className="mt-5 rounded-md border border-white/10 bg-white/[0.02] p-4"><div className="flex items-center gap-2"><Fingerprint size={16} className="text-sky-300"/><p className="text-xs font-medium text-slate-300">SHA-256 manifest fingerprint</p></div><p className="mt-3 break-all font-mono text-[11px] leading-5 text-white">{data.manifestSha256}</p></div>
    </section>

    <section className="grid gap-px overflow-hidden rounded-md border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-5">
      {[
        ["Integrity model",data.integrityModel],
        ["Signed",data.signed?"yes":"no"],
        ["Immutable",data.immutable?"yes":"no"],
        ["Chain of custody",data.chainOfCustodyQualified?"qualified":"not qualified"],
        ["Export",data.exportEnabled?"enabled":"disabled"],
      ].map(([label,value])=><div key={String(label)} className="bg-slate-950 p-4"><p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-sm font-semibold text-white">{String(value)}</p></div>)}
    </section>

    <section className="grid gap-px overflow-hidden rounded-md border border-white/10 bg-white/10 sm:grid-cols-3">
      <div className="bg-slate-950 p-4"><p className="text-xs text-slate-500">Canonical events</p><p className="mt-2 text-3xl font-semibold text-white">{data.events.length}</p></div>
      <div className="bg-slate-950 p-4"><p className="text-xs text-slate-500">Correlations</p><p className="mt-2 text-3xl font-semibold text-white">{data.correlations.length}</p></div>
      <div className="bg-slate-950 p-4"><p className="text-xs text-slate-500">Protection decisions</p><p className="mt-2 text-3xl font-semibold text-white">{data.protectionAlerts.length}</p></div>
    </section>

    <section className="overflow-hidden rounded-md border border-white/10">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3"><ShieldCheck size={17} className="text-sky-300"/><h2 className="text-sm font-semibold text-white">Evidence inventory</h2></div>
      {data.events.length===0?<p className="p-6 text-sm text-slate-400">No canonical events are linked to this manifest.</p>:<div className="overflow-x-auto"><table className="min-w-[1080px] w-full text-left text-xs"><thead className="border-b border-white/10 text-[10px] uppercase text-slate-500"><tr><th className="px-4 py-2.5">Event</th><th className="px-3 py-2.5">Severity</th><th className="px-3 py-2.5">Host</th><th className="px-3 py-2.5">Category</th><th className="px-3 py-2.5">Authority</th><th className="px-3 py-2.5">Action</th><th className="px-4 py-2.5 text-right">Time</th></tr></thead><tbody className="divide-y divide-white/10">{data.events.map(row=><tr key={row.id}><td className="px-4 py-3"><p className="font-medium text-white">{row.eventType.replaceAll("."," · ").replaceAll("_"," ")}</p><p className="mt-1 font-mono text-[10px] text-slate-600">{row.id}</p></td><td className="px-3 py-3 capitalize text-slate-300">{row.severity}</td><td className="px-3 py-3 text-slate-400">{row.hostname||row.host||"—"}</td><td className="px-3 py-3 text-slate-300">{row.attackCategory.replaceAll("_"," ")}</td><td className="px-3 py-3 text-slate-400">{row.observationAuthority||"—"}</td><td className="px-3 py-3 text-slate-300">{(row.actionTaken||"observed").replaceAll("_"," ")}</td><td className="px-4 py-3 text-right"><Timestamp value={row.timestamp}/></td></tr>)}</tbody></table></div>}
    </section>

    <section className="grid gap-4 xl:grid-cols-2">
      <div className="overflow-hidden rounded-md border border-white/10"><div className="flex items-center gap-2 border-b border-white/10 px-4 py-3"><GitMerge size={17} className="text-fuchsia-300"/><h2 className="text-sm font-semibold text-white">Correlation records</h2></div>{data.correlations.length===0?<p className="p-5 text-sm text-slate-400">No correlation records are linked.</p>:<ul className="divide-y divide-white/10">{data.correlations.map(row=><li key={row.id} className="p-4"><div className="flex justify-between gap-3"><span className="font-medium text-white">{row.ruleName}</span><span className="text-xs capitalize text-slate-400">{row.severity}</span></div><p className="mt-2 text-xs text-slate-500">{row.eventCount} events · <Timestamp value={row.detectedAt}/></p>{row.description&&<p className="mt-2 text-xs text-slate-400">{row.description}</p>}</li>)}</ul>}</div>
      <div className="overflow-hidden rounded-md border border-white/10"><div className="flex items-center gap-2 border-b border-white/10 px-4 py-3"><LockKeyhole size={17} className="text-amber-200"/><h2 className="text-sm font-semibold text-white">Protection & response provenance</h2></div>{data.protectionAlerts.length===0?<p className="p-5 text-sm text-slate-400">No protection decisions are linked.</p>:<ul className="divide-y divide-white/10">{data.protectionAlerts.map(row=><li key={row.id} className="p-4"><div className="flex justify-between gap-3"><span className="font-medium text-white">{row.title}</span><span className="text-xs capitalize text-slate-400">{(row.responseStatus||"no response request").replaceAll("_"," ")}</span></div><p className="mt-2 text-xs text-slate-500">{row.detectorId} · policy v{row.policyVersion}</p>{row.executionRequestId&&<p className="mt-2 text-xs text-slate-400">Approvals {row.approvalCount}/{row.requiredApprovals} · {row.impactClass||"unknown"} impact</p>}</li>)}</ul>}</div>
    </section>
  </ConsolePageShell>;
}
