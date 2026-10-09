import { notFound, redirect } from "next/navigation";
import { CircleOff, Shield } from "lucide-react";
import { ConsolePageShell } from "../../../components/ConsolePageShell";
import { getSession, verifyEmail } from "../../../lib/auth";
import { loadGuardCommandCenter } from "../../../lib/migraguard/data";
import { GuardNav } from "../../GuardNav";
import { RefreshAlerts } from "../../RefreshAlerts";
import { Timestamp } from "../../GuardView";

export const dynamic="force-dynamic";

const domains:Record<string,{title:string;description:string}> = {
  identity:{title:"Identity",description:"Authentication, session, and account-risk evidence"},
  edge:{title:"Edge / WAF",description:"Ingress, WAF, reverse-proxy, and request-blocking evidence"},
  api:{title:"API",description:"Application API abuse and request-security evidence"},
  infrastructure:{title:"Infrastructure",description:"Host integrity, process, listener, and infrastructure evidence"},
  malware:{title:"Malware",description:"Malware detection and scan-health evidence"},
  mail:{title:"Mail / DNS / TLS",description:"Messaging, DNS, certificate, and transport-security evidence"},
  secrets:{title:"Secrets",description:"Credential and secret-exposure evidence"},
  "supply-chain":{title:"Supply Chain",description:"Dependency and build-chain security evidence"},
  content:{title:"Content & Uploads",description:"Upload and content-validation security evidence"},
};

export default async function ProtectionDomainPage({params}:{params:Promise<{domain:string}>}){
  const {domain}=await params;
  const config=domains[domain];
  if(!config)notFound();
  const session=await getSession();
  if(!session)redirect("/console/login");
  if(!verifyEmail(session.email))redirect("/unauthorized");
  const result=await loadGuardCommandCenter();
  if(result.state==="forbidden")redirect("/unauthorized");
  const data=result.state==="ready"?result.data:null;
  const summary=data?.domains.find(row=>row.key===domain);
  const activity=data?.activity.filter(row=>row.domain===domain)||[];
  return <ConsolePageShell session={session} activePath="/console/migraguard" title={config.title} subtitle={config.description} actions={<RefreshAlerts/>}>
    <GuardNav/>
    {!data?<section className="rounded-md border border-rose-400/20 p-6"><div className="flex gap-3"><CircleOff size={20} className="text-rose-300"/><p className="text-sm text-slate-300">Canonical protection evidence unavailable. No healthy state is inferred.</p></div></section>:
    <>
      <section className="rounded-md border border-white/10 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex gap-3"><div className="grid h-10 w-10 place-items-center rounded-md border border-white/10"><Shield size={20} className="text-sky-300"/></div><div><h2 className="font-semibold text-white">{config.title} protection state</h2><p className="mt-1 max-w-2xl text-sm text-slate-400">{summary?.detail||"No dedicated canonical evidence has been observed in this bounded view."}</p></div></div>
          <span className="rounded-md border border-white/10 px-2 py-1 text-[10px] font-semibold uppercase text-slate-400">{summary?.state||"unconnected"}</span>
        </div>
        <div className="mt-5 grid gap-px overflow-hidden rounded-md bg-white/10 sm:grid-cols-2">
          <div className="bg-slate-950 p-4"><p className="text-xs text-slate-500">Canonical events</p><p className="mt-2 text-2xl font-semibold text-white">{summary?.events??"—"}</p></div>
          <div className="bg-slate-950 p-4"><p className="text-xs text-slate-500">Representative activity</p><p className="mt-2 text-2xl font-semibold text-white">{activity.length}</p></div>
        </div>
      </section>
      <section className="overflow-hidden rounded-md border border-white/10">
        <div className="border-b border-white/10 px-4 py-3"><h2 className="text-sm font-semibold text-white">Domain activity</h2></div>
        {activity.length===0?<p className="p-6 text-sm text-slate-400">No canonical events for this domain are present in the current evidence window. This does not establish that the domain is protected.</p>:<div className="overflow-x-auto"><table className="min-w-[900px] w-full text-left text-xs"><thead className="border-b border-white/10 text-[10px] uppercase text-slate-500"><tr><th className="px-4 py-2.5">Severity</th><th className="px-3 py-2.5">Event</th><th className="px-3 py-2.5">Source → target</th><th className="px-3 py-2.5">Action</th><th className="px-4 py-2.5 text-right">Time</th></tr></thead><tbody className="divide-y divide-white/10">{activity.map(row=><tr key={row.id}><td className="px-4 py-3 capitalize text-slate-300">{row.severity}</td><td className="px-3 py-3 font-medium text-white">{row.title}</td><td className="px-3 py-3 text-slate-400">{row.source} → {row.target}</td><td className="px-3 py-3 text-slate-300">{row.action}</td><td className="px-4 py-3 text-right"><Timestamp value={row.timestamp}/></td></tr>)}</tbody></table></div>}
      </section>
    </>}
  </ConsolePageShell>;
}
