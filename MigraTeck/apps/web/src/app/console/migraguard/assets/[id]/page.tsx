import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Activity, AlertTriangle, Link2, Server, ShieldCheck } from "lucide-react";
import { ConsolePageShell } from "../../../components/ConsolePageShell";
import { getSession, verifyEmail } from "../../../lib/auth";
import { loadGuardAssetDetail } from "../../../lib/migraguard/asset-context-data";
import { GuardNav } from "../../GuardNav";
import { RefreshAlerts } from "../../RefreshAlerts";
import { Timestamp } from "../../GuardView";

export const dynamic="force-dynamic";

function stateClass(value:string|null){
  if(value==="current"||value==="active")return "text-emerald-300";
  if(value==="stale"||value==="offline"||value==="suspended")return "text-amber-300";
  return "text-slate-400";
}

export default async function AssetDetailPage({params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  const session=await getSession();
  if(!session)redirect("/console/login");
  if(!verifyEmail(session.email))redirect("/unauthorized");
  const result=await loadGuardAssetDetail(id);
  if(result.state==="forbidden")redirect("/unauthorized");
  if(result.state!=="ready")notFound();
  const data=result.data;

  return <ConsolePageShell session={session} activePath="/console/migraguard" title={data.asset.name} subtitle="Asset inventory, associated telemetry, canonical evidence, and incident context" actions={<RefreshAlerts/>}>
    <GuardNav/>
    <div className="flex"><Link href="/console/migraguard/assets" className="text-xs text-slate-400 hover:text-white">← Back to assets</Link></div>

    <section className="rounded-md border border-white/10 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2"><Server size={18} className="text-sky-300"/><h2 className="font-semibold text-white">{data.asset.name}</h2></div>
          <p className="mt-2 text-sm text-slate-400">{data.asset.hostname||"No hostname"}{data.asset.ipAddress?` · ${data.asset.ipAddress}`:""}</p>
          <div className="mt-3 flex flex-wrap gap-2">{data.asset.tags.map(tag=><span key={tag} className="rounded border border-white/10 px-2 py-1 text-[10px] text-slate-400">{tag}</span>)}</div>
        </div>
        <div className="text-right text-xs text-slate-400">
          <p className="capitalize">{data.asset.type}</p>
          <p className="mt-1">Risk {data.asset.riskScore??"—"}</p>
          <p className="mt-1 font-mono text-[10px] text-slate-600">{data.asset.assetId}</p>
        </div>
      </div>
      <dl className="mt-5 grid gap-px overflow-hidden rounded-md bg-white/10 sm:grid-cols-4">
        <div className="bg-slate-950 p-3"><dt className="text-[10px] text-slate-500">Matched agents</dt><dd className="mt-1 text-xl font-semibold text-white">{data.agents.length}</dd></div>
        <div className="bg-slate-950 p-3"><dt className="text-[10px] text-slate-500">Recent evidence</dt><dd className="mt-1 text-xl font-semibold text-white">{data.recentEvents.length}</dd></div>
        <div className="bg-slate-950 p-3"><dt className="text-[10px] text-slate-500">Incidents</dt><dd className="mt-1 text-xl font-semibold text-white">{data.incidents.length}</dd></div>
        <div className="bg-slate-950 p-3"><dt className="text-[10px] text-slate-500">Last scan</dt><dd className="mt-1 text-sm font-semibold text-white">{data.asset.lastScanAt?<Timestamp value={data.asset.lastScanAt}/>:<span className="text-slate-600">Unknown</span>}</dd></div>
      </dl>
    </section>

    <section className="rounded-md border border-amber-400/20 bg-amber-500/[0.04] p-4">
      <div className="flex gap-3"><Link2 size={18} className="text-amber-200"/><div><h2 className="font-semibold text-white">Association authority</h2><p className="mt-1 text-sm text-slate-400">{data.associationAuthority==="hostname_exact_not_identity"?"Agent, event, and incident context below is associated by exact hostname equality. It is operator context, not enrollment-backed asset identity.":"No hostname association is available for this asset."}</p></div></div>
    </section>

    <section className="grid gap-4 xl:grid-cols-[.8fr_1.2fr]">
      <div className="overflow-hidden rounded-md border border-white/10">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3"><ShieldCheck size={17} className="text-emerald-300"/><h2 className="text-sm font-semibold text-white">Associated agents</h2></div>
        {data.agents.length===0?<p className="p-5 text-sm text-slate-400">No exact-hostname agent match is available.</p>:<div className="divide-y divide-white/10">{data.agents.map(row=><article key={row.agentId} className="p-4"><div className="flex items-start justify-between gap-4"><div><h3 className="font-medium text-white">{row.name}</h3><p className="mt-1 text-xs text-slate-500">{row.platform||"unknown platform"}{row.version?` · ${row.version}`:""}</p></div><span className={"text-xs capitalize "+stateClass(row.agentStatus)}>{row.agentStatus}</span></div><dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2"><div><dt className="text-slate-600">Persisted trust</dt><dd className={"mt-1 capitalize "+stateClass(row.persistedTrustState)}>{row.persistedTrustState||"unknown"}</dd></div><div><dt className="text-slate-600">Last canonical event</dt><dd className="mt-1 text-slate-300">{row.lastEventAt?<Timestamp value={row.lastEventAt}/>:<span>Unknown</span>}</dd></div><div><dt className="text-slate-600">Last authenticated</dt><dd className="mt-1 text-slate-300">{row.lastAuthenticatedAt?<Timestamp value={row.lastAuthenticatedAt}/>:<span>Unknown</span>}</dd></div><div><dt className="text-slate-600">Last heartbeat</dt><dd className="mt-1 text-slate-300">{row.lastHeartbeatAt?<Timestamp value={row.lastHeartbeatAt}/>:<span>Unknown</span>}</dd></div></dl></article>)}</div>}
      </div>

      <div className="overflow-hidden rounded-md border border-white/10">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3"><AlertTriangle size={17} className="text-amber-200"/><h2 className="text-sm font-semibold text-white">Associated incidents</h2></div>
        {data.incidents.length===0?<p className="p-5 text-sm text-slate-400">No incidents have an exact node-hostname association.</p>:<div className="divide-y divide-white/10">{data.incidents.map(row=><Link key={row.id} href={"/console/migraguard/incidents/"+row.id} className="block p-4 transition hover:bg-white/[0.03]"><div className="flex justify-between gap-4"><div><h3 className="font-medium text-white">{row.title}</h3><p className="mt-1 text-xs text-slate-500">{row.source||"security"} · {row.status}</p></div><span className="text-xs capitalize text-slate-400">{row.severity}</span></div><p className="mt-2 text-[10px] text-slate-600"><Timestamp value={row.createdAt}/></p></Link>)}</div>}
      </div>
    </section>

    <section className="overflow-hidden rounded-md border border-white/10">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3"><Activity size={17} className="text-fuchsia-300"/><h2 className="text-sm font-semibold text-white">Recent canonical evidence</h2></div>
      {data.recentEvents.length===0?<p className="p-6 text-sm text-slate-400">No canonical security events match this asset hostname.</p>:<div className="overflow-x-auto"><table className="min-w-[980px] w-full text-left text-xs"><thead className="border-b border-white/10 text-[10px] uppercase text-slate-500"><tr><th className="px-4 py-2.5">Severity</th><th className="px-3 py-2.5">Event</th><th className="px-3 py-2.5">Category</th><th className="px-3 py-2.5">Authority</th><th className="px-3 py-2.5">Action</th><th className="px-4 py-2.5 text-right">Time</th></tr></thead><tbody className="divide-y divide-white/10">{data.recentEvents.map(row=><tr key={row.id}><td className="px-4 py-3 capitalize text-slate-300">{row.severity}</td><td className="px-3 py-3 font-medium text-white">{row.eventType.replaceAll("."," · ").replaceAll("_"," ")}</td><td className="px-3 py-3 text-slate-300">{row.attackCategory.replaceAll("_"," ")}</td><td className="px-3 py-3 text-slate-400">{row.observationAuthority||"unknown"}</td><td className="px-3 py-3 text-slate-400">{(row.actionTaken||"observed").replaceAll("_"," ")}</td><td className="px-4 py-3 text-right"><Timestamp value={row.timestamp}/></td></tr>)}</tbody></table></div>}
    </section>
  </ConsolePageShell>;
}
