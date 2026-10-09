import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Activity, AlertTriangle, Bug, CheckCircle2, ChevronRight, CircleOff, Crosshair, FileSearch,
  Fingerprint, Gavel, Globe2, History, KeyRound, LockKeyhole, MailCheck, Network, PackageCheck,
  Radar, ScanLine, Server, Shield, ShieldAlert, ShieldCheck, Upload,
} from "lucide-react";
import { getSession, verifyEmail } from "../lib/auth";
import { ConsolePageShell } from "../components/ConsolePageShell";
import { loadGuardCommandCenter } from "../lib/migraguard/data";
import type { CommandCenter } from "../lib/migraguard/socket";
import { GuardNav } from "./GuardNav";
import { RefreshAlerts } from "./RefreshAlerts";
import { SecurityOverview } from "./SecurityOverview";
import { Timestamp } from "./GuardView";

export const dynamic = "force-dynamic";

const compactNumber = new Intl.NumberFormat("en-US",{notation:"compact",maximumFractionDigits:1});
const count = (value:number) => compactNumber.format(value);
const stateStyle = {
  normal:"border-emerald-400/25 bg-emerald-500/10 text-emerald-300",
  elevated:"border-amber-400/25 bg-amber-500/10 text-amber-200",
  critical:"border-rose-400/25 bg-rose-500/10 text-rose-300",
  unknown:"border-slate-400/20 bg-slate-500/10 text-slate-300",
};

const domainIcons:Record<string,typeof Shield>={
  edge:Globe2,identity:Fingerprint,api:Network,infrastructure:Server,secrets:KeyRound,
  "supply-chain":PackageCheck,content:Upload,mail:MailCheck,malware:Bug,response:Gavel,
  forensics:FileSearch,monitoring:Radar,
};

function StateDot({state}:{state:string}) {
  const color=state==="active" ? "bg-emerald-400" : state==="critical" ? "bg-rose-400" : state==="attention" ? "bg-amber-300" : state==="limited" ? "bg-sky-300" : "bg-slate-500";
  return <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} aria-hidden="true"/>;
}

function CommandUnavailable({state}:{state:string}) {
  return <section role="status" className="rounded-md border border-rose-400/20 bg-rose-500/[0.05] p-6">
    <div className="flex gap-3"><CircleOff className="mt-0.5 text-rose-300" size={20}/><div><h2 className="text-sm font-semibold text-rose-200">Security command data unavailable</h2><p className="mt-2 text-sm text-slate-300">MigraGuard cannot verify the ecosystem security state. No protected or normal state is being claimed.</p><p className="mt-2 text-xs text-slate-500">Feed state: {state}</p></div></div>
  </section>;
}

function CommandMetric({label,value,detail,tone="neutral"}:{label:string;value:string;detail:string;tone?:"neutral"|"good"|"warning"|"critical"}) {
  const color=tone==="good" ? "text-emerald-300" : tone==="warning" ? "text-amber-200" : tone==="critical" ? "text-rose-300" : "text-white";
  return <div className="min-w-0 border-t border-white/10 px-4 py-4 xl:border-l xl:border-t-0 first:xl:border-l-0">
    <dt className="text-[11px] font-medium uppercase text-slate-500">{label}</dt><dd className={`mt-1 text-xl font-semibold ${color}`}>{value}</dd><p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
  </div>;
}

function MiniTrend({label,values,color}:{label:string;values:number[];color:string}) {
  const max=Math.max(...values,1);
  return <div className="grid grid-cols-[88px_minmax(0,1fr)_54px] items-end gap-3">
    <span className="pb-1 text-xs text-slate-400">{label}</span>
    <div className="flex h-9 items-end gap-1 border-b border-white/10">{values.map((value,index)=><span key={index} title={`${value} events`} className={`min-w-1 flex-1 rounded-t-sm ${color}`} style={{height:`${Math.max(3,Math.round(value/max*100))}%`}}/>)}</div>
    <span className="pb-1 text-right text-xs font-medium text-slate-300">{count(values.reduce((sum,value)=>sum+value,0))}</span>
  </div>;
}

function Severity({value}:{value:CommandCenter["activity"][number]["severity"]}) {
  const style=value==="critical" ? "border-rose-400/25 bg-rose-500/10 text-rose-300" : value==="high" ? "border-amber-400/25 bg-amber-500/10 text-amber-200" : value==="medium" ? "border-sky-400/20 bg-sky-500/10 text-sky-300" : value==="low" ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-300" : "border-slate-400/20 bg-slate-500/10 text-slate-300";
  return <span className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-semibold capitalize ${style}`}>{value}</span>;
}

function CommandCenterView({data}:{data:CommandCenter}) {
  const trend={edge:data.threats.trend.map(item=>item.edge),identity:data.threats.trend.map(item=>item.identity),infrastructure:data.threats.trend.map(item=>item.infrastructure),malware:data.threats.trend.map(item=>item.malware)};
  const threatCards=[
    {label:"WAF detections",value:data.threats.counts.wafDetected,detail:`${count(data.threats.counts.wafBlocked)} requests blocked`,icon:Globe2,tone:"text-sky-300"},
    {label:"Authentication",value:data.threats.counts.bruteForce,detail:"Repeated-failure observations",icon:Fingerprint,tone:"text-amber-200"},
    {label:"Infrastructure",value:data.threats.counts.infrastructure,detail:"Integrity and listener findings",icon:Server,tone:"text-fuchsia-300"},
    {label:"Malware findings",value:data.threats.counts.malwareDetected,detail:`${data.threats.counts.scanFailures} incomplete scans`,icon:Bug,tone:data.threats.counts.malwareDetected>0?"text-rose-300":"text-emerald-300"},
    {label:"API abuse",value:data.threats.counts.api,detail:data.threats.counts.api>0?"Canonical API abuse evidence":"No API evidence in this bounded view",icon:Network,tone:data.threats.counts.api>0?"text-sky-300":"text-slate-500"},
    {label:"Monitoring failures",value:data.threats.counts.monitoring,detail:"Reduced-coverage observations",icon:Radar,tone:"text-amber-200"},
  ];
  const incidentBuckets=[
    ["Open",["open"]],
    ["Investigating",["investigating","in_progress"]],
    ["Contained",["contained"]],
    ["Approval",["awaiting_approval","pending_approval"]],
    ["Resolved",["resolved","closed"]],
    ["Failed",["failed"]],
  ] as const;
  const incidentCount=(states:readonly string[])=>data.incidents.items.filter(item=>states.includes(item.status.toLowerCase())).length;
  return <>
    <section aria-labelledby="global-command" className="overflow-hidden rounded-md border border-white/10 bg-white/[0.02]">
      <div className="flex flex-wrap items-start justify-between gap-5 p-5 lg:p-6">
        <div className="flex min-w-0 gap-4"><div className={`grid h-14 w-14 shrink-0 place-items-center rounded-md border ${stateStyle[data.overall.state]}`}>{data.overall.state==="normal"?<ShieldCheck size={29}/>:<ShieldAlert size={29}/>}</div><div><p className="text-[11px] font-semibold uppercase text-slate-500">Global security command</p><div className="mt-1 flex flex-wrap items-center gap-3"><h2 id="global-command" className="text-2xl font-semibold text-white">{data.overall.state.toUpperCase()}</h2><span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase ${stateStyle[data.overall.state]}`}>Evidence-derived state</span></div><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{data.overall.reason}</p>{data.overall.lastVerifiedAt&&<p className="mt-2 text-xs text-slate-500">Last verified evidence <Timestamp value={data.overall.lastVerifiedAt}/></p>}</div></div>
        <button type="button" disabled title={data.response.authority==="governed"?"Execution authority is connected, but no executor is enabled":"Hardened execution authority is not connected"} className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-xs font-medium text-slate-500 disabled:cursor-not-allowed"><LockKeyhole size={15}/>{data.response.authority==="governed"?"Executor intentionally disabled":"Emergency controls unavailable"}</button>
      </div>
      <dl className="grid border-t border-white/10 sm:grid-cols-2 xl:grid-cols-6">
        <CommandMetric label={data.assets.authoritative?"Protected asset inventory":"Event-producing assets"} value={String(data.assets.total)} detail={data.assets.authoritative?"Authoritative inventory joined to canonical evidence":"Assets represented in this canonical window"} tone={data.assets.total>0?"good":"warning"}/>
        <CommandMetric label="Active incidents" value={data.incidents.connected?String(data.incidents.active):"—"} detail={data.incidents.connected?`${data.incidents.critical} critical`:"Incident feed not connected"} tone={data.incidents.critical>0?"critical":"neutral"}/>
        <CommandMetric label="Containment in effect" value={data.response.authority==="not-connected"?"—":String(data.response.inEffect)} detail={data.response.authority==="not-connected"?"Response authority not connected":"No automatic action assumed"} tone={data.response.inEffect>0?"warning":"neutral"}/>
        <CommandMetric label="Canonical events" value={String(data.audit.canonicalEvents)} detail="Deduplicated events in this bounded view" tone={data.audit.canonicalEvents>0?"good":"warning"}/>
        <CommandMetric label="Pending approvals" value={data.response.authority==="not-connected"?"—":String(data.response.pendingApprovals)} detail={data.response.authority==="governed"?"Governed request approvals":"Execution authority not connected"} tone={data.response.pendingApprovals>0?"warning":"neutral"}/>
        <CommandMetric label="Evidence window" value={`${data.windowHours}h`} detail={`Updated ${new Intl.DateTimeFormat("en-US",{hour:"numeric",minute:"2-digit",timeZone:"UTC",timeZoneName:"short"}).format(new Date(data.generatedAt))}`}/>
      </dl>
    </section>

    <section aria-labelledby="authority-heading" className="overflow-hidden rounded-md border border-white/10">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3"><div><h2 id="authority-heading" className="text-sm font-semibold text-white">Security authority matrix</h2><p className="mt-0.5 text-xs text-slate-500">Independent bounded read models · unavailable never means healthy or zero</p></div><ShieldCheck size={17} className="text-emerald-300"/></div>
      <div className="grid gap-px bg-white/10 sm:grid-cols-2 xl:grid-cols-3">{(data.authorities||[]).map(authority=><Link key={authority.key} href={authority.href} prefetch={false} className="group bg-slate-950 p-4 transition hover:bg-white/[0.03]"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><StateDot state={authority.state==="connected"?"active":"limited"}/><h3 className="text-sm font-medium text-white group-hover:text-sky-200">{authority.name}</h3></div><ChevronRight size={14} className="text-slate-600 group-hover:text-slate-300"/></div><p className="mt-2 text-xs leading-5 text-slate-500">{authority.detail}</p><p className={authority.state==="connected"?"mt-3 text-[10px] font-semibold uppercase tracking-wide text-emerald-300":"mt-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500"}>{authority.state}</p></Link>)}</div>
    </section>

    <section id="threats" aria-labelledby="threat-heading" className="scroll-mt-4">
      <div className="mb-3 flex items-end justify-between gap-4"><div><h2 id="threat-heading" className="text-base font-semibold text-white">Threat command center</h2><p className="mt-1 text-xs text-slate-500">Trusted security evidence · last 24 hours</p></div><Crosshair size={19} className="text-rose-300"/></div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,1fr)]">
        <div className="grid gap-px overflow-hidden rounded-md border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-3">{threatCards.map(card=>{const Icon=card.icon;return <div key={card.label} className="bg-slate-950 p-4"><div className="flex items-center justify-between"><Icon size={17} className={card.tone}/>{card.value===null&&<span className="text-[10px] font-medium uppercase text-slate-600">Unconnected</span>}</div><p className="mt-4 text-xs text-slate-400">{card.label}</p><p className={`mt-1 text-2xl font-semibold ${card.value===null?"text-slate-600":"text-white"}`}>{card.value===null?"—":count(card.value)}</p><p className="mt-1 text-xs leading-5 text-slate-500">{card.detail}</p></div>})}</div>
        <div className="rounded-md border border-white/10 p-4"><div className="flex items-center justify-between"><div><h3 className="text-sm font-semibold text-white">Activity trend</h3><p className="mt-1 text-xs text-slate-500">Two-hour evidence intervals</p></div><Activity size={17} className="text-slate-400"/></div><div className="mt-5 space-y-4"><MiniTrend label="Edge" values={trend.edge} color="bg-sky-400/70"/><MiniTrend label="Identity" values={trend.identity} color="bg-amber-300/70"/><MiniTrend label="Infrastructure" values={trend.infrastructure} color="bg-fuchsia-400/70"/><MiniTrend label="Malware" values={trend.malware} color="bg-rose-400/70"/></div></div>
      </div>
    </section>

    <section id="activity" aria-labelledby="activity-heading" className="scroll-mt-4 overflow-hidden rounded-md border border-white/10">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3"><div><h2 id="activity-heading" className="text-sm font-semibold text-white">Live security activity</h2><p className="mt-0.5 text-xs text-slate-500">Recent trusted evidence across connected protection domains</p></div><span className="text-xs text-slate-500">{data.activity.length} representative events</span></div>
      {data.activity.length===0?<p className="px-4 py-10 text-sm text-slate-400">No trusted activity is available. This is not a claim of safety.</p>:<div className="overflow-x-auto"><table className="min-w-[1220px] w-full text-left text-xs"><thead className="border-b border-white/10 bg-white/[0.02] text-[10px] uppercase text-slate-500"><tr><th className="px-4 py-2.5 font-medium">Severity</th><th className="px-3 py-2.5 font-medium">Event</th><th className="px-3 py-2.5 font-medium">Source → target</th><th className="px-3 py-2.5 font-medium">Rule / detection</th><th className="px-3 py-2.5 font-medium">Action</th><th className="px-3 py-2.5 font-medium">State</th><th className="px-3 py-2.5 font-medium">Evidence</th><th className="px-4 py-2.5 text-right font-medium">Time</th></tr></thead><tbody className="divide-y divide-white/10">{data.activity.slice(0,14).map(event=><tr key={event.id} className="hover:bg-white/[0.02]"><td className="px-4 py-3"><Severity value={event.severity}/></td><td className="px-3 py-3"><p className="font-medium text-white">{event.title}</p><p className="mt-1 capitalize text-slate-500">{event.domain}</p></td><td className="px-3 py-3"><p className="max-w-56 truncate text-slate-300" title={event.source}>{event.source}</p><p className="mt-1 max-w-56 truncate text-slate-500" title={event.target}>→ {event.target}</p></td><td className="px-3 py-3 font-mono text-[11px] text-slate-400">{event.detection}</td><td className="px-3 py-3 text-slate-300">{event.action}</td><td className="px-3 py-3"><span className="inline-flex items-center gap-1.5 capitalize text-slate-300"><StateDot state={event.state==="verified"?"active":event.state==="degraded"?"attention":"limited"}/>{event.state}</span></td><td className="px-3 py-3"><details className="max-w-64"><summary className="cursor-pointer text-sky-300">Inspect</summary><ul className="mt-2 space-y-1 text-[11px] leading-4 text-slate-400">{event.evidence.map(item=><li key={item}>{item}</li>)}</ul><p className="mt-2 font-mono text-[10px] text-slate-600">Evidence {event.evidenceId}</p></details></td><td className="px-4 py-3 text-right"><Timestamp value={event.timestamp}/></td></tr>)}</tbody></table></div>}
    </section>

    <div className="grid gap-4 xl:grid-cols-2">
      <section id="incidents" aria-labelledby="incidents-heading" className="scroll-mt-4 rounded-md border border-white/10">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3"><div><h2 id="incidents-heading" className="text-sm font-semibold text-white">Incident operations</h2><p className="mt-0.5 text-xs text-slate-500">Detect → correlate → decide → respond → verify → close</p></div><AlertTriangle size={17} className="text-amber-200"/></div>
        <div className="grid grid-cols-3 gap-px border-b border-white/10 bg-white/10 sm:grid-cols-6">{incidentBuckets.map(([label,states])=><div key={label} className="bg-slate-950 px-2 py-3 text-center"><p className="text-lg font-semibold text-white">{data.incidents.connected?incidentCount(states):"—"}</p><p className="mt-1 text-[10px] text-slate-500">{label}</p></div>)}</div>
        {!data.incidents.connected?<div className="flex gap-3 p-5"><CircleOff size={19} className="mt-0.5 text-slate-400"/><div><p className="text-sm font-medium text-white">Incident correlation not connected</p><p className="mt-1 text-xs leading-5 text-slate-500">Canonical events remain visible above. This view does not infer that zero incidents exist.</p></div></div>:data.incidents.items.length===0?<div className="flex gap-3 p-5"><CheckCircle2 size={19} className="mt-0.5 text-emerald-300"/><div><p className="text-sm font-medium text-white">No persisted incidents</p><p className="mt-1 text-xs leading-5 text-slate-500">The connected incident source reports no active records.</p></div></div>:<ul className="divide-y divide-white/10">{data.incidents.items.map(item=><li key={item.id} className="p-4"><div className="flex items-center justify-between"><p className="text-sm font-medium text-white">{item.title}</p><span className="text-xs capitalize text-slate-400">{item.status}</span></div><p className="mt-1 text-xs text-slate-500">{item.summary}</p></li>)}</ul>}
      </section>
      <section id="response" aria-labelledby="response-heading" className="scroll-mt-4 rounded-md border border-white/10">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3"><div><h2 id="response-heading" className="text-sm font-semibold text-white">Containment & execution authority</h2><p className="mt-0.5 text-xs text-slate-500">Fail-closed response governance</p></div><Gavel size={17} className="text-fuchsia-300"/></div>
        <dl className="grid grid-cols-2 gap-px bg-white/10 sm:grid-cols-4"><div className="bg-slate-950 p-3"><dt className="text-[10px] text-slate-500">Automatic remediation</dt><dd className="mt-1 text-sm font-semibold text-slate-300">Off</dd></div><div className="bg-slate-950 p-3"><dt className="text-[10px] text-slate-500">Pending approval</dt><dd className="mt-1 text-sm font-semibold text-white">{data.response.authority==="governed"?data.response.pendingApprovals:"—"}</dd></div><div className="bg-slate-950 p-3"><dt className="text-[10px] text-slate-500">Active capabilities</dt><dd className="mt-1 text-sm font-semibold text-white">{data.response.authority==="governed"?data.response.capabilities.active:"—"}</dd></div><div className="bg-slate-950 p-3"><dt className="text-[10px] text-slate-500">Receipts</dt><dd className="mt-1 text-sm font-semibold text-white">{data.response.authority==="governed"?data.response.receipts.total:"—"}</dd></div></dl>
        <div className="p-4"><div className="flex gap-3"><LockKeyhole size={18} className="mt-0.5 shrink-0 text-amber-200"/><div><p className="text-sm font-medium text-white">{data.response.authority==="governed"?"Governed execution authority connected":"Hardened execution authority is not connected"}</p><p className="mt-1 text-xs leading-5 text-slate-500">{data.response.authority==="governed"?"Requests, approval progress, capability lifecycle, and execution receipts are visible. The real executor remains intentionally disabled.":"No response authority is inferred from canonical event data."}</p></div></div>{data.response.requests.length>0&&<ul className="mt-4 divide-y divide-white/10 border-y border-white/10">{data.response.requests.slice(0,4).map(request=><li key={request.id} className="flex items-center justify-between gap-4 py-2.5 text-xs"><div><span className="text-slate-300">{request.target}</span><span className="ml-2 capitalize text-slate-600">{request.impactClass}</span></div><span className="capitalize text-slate-500">{request.status} · {request.approvalCount}/{request.requiredApprovals}</span></li>)}</ul>}</div>
      </section>
    </div>

    <section aria-labelledby="domains-heading"><div className="mb-3"><h2 id="domains-heading" className="text-base font-semibold text-white">Protection domains</h2><p className="mt-1 text-xs text-slate-500">Connected evidence sources and explicit visibility gaps</p></div><div className="grid gap-px overflow-hidden rounded-md border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{data.domains.map(domain=>{const Icon=domainIcons[domain.key]??Shield;const href=domain.key==="response"?"/console/migraguard/response":domain.key==="forensics"?"/console/migraguard/forensics":domain.key==="monitoring"?"/console/migraguard/monitoring":`/console/migraguard/protection/${domain.key}`;return <Link id={`domain-${domain.key}`} key={domain.key} href={href} prefetch={false} className="group scroll-mt-4 bg-slate-950 p-4 transition hover:bg-white/[0.03]"><div className="flex items-start justify-between gap-3"><div className="grid h-8 w-8 place-items-center rounded-md border border-white/10 text-slate-300"><Icon size={16}/></div><div className="flex items-center gap-1.5"><StateDot state={domain.state}/><span className="text-[10px] font-medium uppercase text-slate-500">{domain.state}</span></div></div><div className="mt-4 flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-white group-hover:text-sky-200">{domain.name}</h3><ChevronRight size={14} className="text-slate-700 group-hover:text-slate-300"/></div><div className="mt-2 flex items-end justify-between gap-3"><p className="text-xs leading-5 text-slate-500">{domain.detail}</p>{domain.events!==null&&<span className="shrink-0 text-lg font-semibold text-slate-200">{count(domain.events)}</span>}</div></Link>})}</div></section>

    <section id="assets" aria-labelledby="assets-heading" className="scroll-mt-4 overflow-hidden rounded-md border border-white/10">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3"><div><h2 id="assets-heading" className="text-sm font-semibold text-white">Asset security matrix</h2><p className="mt-0.5 text-xs text-slate-500">Verified evidence by ecosystem system · 24 hours</p></div><Server size={17} className="text-sky-300"/></div>
      <div className="overflow-x-auto"><table className="min-w-[1320px] w-full text-left text-xs"><thead className="border-b border-white/10 bg-white/[0.02] text-[10px] uppercase text-slate-500"><tr><th className="px-4 py-2.5 font-medium">Asset</th><th className="px-3 py-2.5 font-medium">Coverage</th><th className="px-3 py-2.5 text-right font-medium">Evidence</th><th className="px-3 py-2.5 text-right font-medium">Edge</th><th className="px-3 py-2.5 text-right font-medium">Identity</th><th className="px-3 py-2.5 text-right font-medium">API</th><th className="px-3 py-2.5 text-right font-medium">Infra</th><th className="px-3 py-2.5 text-right font-medium">Secrets</th><th className="px-3 py-2.5 text-right font-medium">Supply</th><th className="px-3 py-2.5 text-right font-medium">Content</th><th className="px-3 py-2.5 text-right font-medium">Mail</th><th className="px-3 py-2.5 text-right font-medium">Malware</th><th className="px-4 py-2.5 text-right font-medium">Last evidence</th></tr></thead><tbody className="divide-y divide-white/10">{data.assets.rows.map(asset=><tr key={asset.name}><td className="px-4 py-3 font-medium text-white">{asset.name}</td><td className="px-3 py-3"><span className="inline-flex items-center gap-1.5 capitalize text-slate-300"><StateDot state={asset.state==="reporting"?"active":asset.state==="degraded"?"attention":"critical"}/>{asset.state}</span></td><td className="px-3 py-3 text-right text-slate-300">{count(asset.evidence24h)}</td><td className="px-3 py-3 text-right text-slate-400">{count(asset.edge24h)}</td><td className="px-3 py-3 text-right text-slate-400">{count(asset.identity24h)}</td><td className="px-3 py-3 text-right text-slate-400">{count(asset.api24h)}</td><td className="px-3 py-3 text-right text-slate-400">{count(asset.infrastructure24h)}</td><td className="px-3 py-3 text-right text-slate-400">{count(asset.secrets24h)}</td><td className="px-3 py-3 text-right text-slate-400">{count(asset.supplyChain24h)}</td><td className="px-3 py-3 text-right text-slate-400">{count(asset.content24h)}</td><td className="px-3 py-3 text-right text-slate-400">{count(asset.mail24h)}</td><td className="px-3 py-3 text-right text-slate-400">{count(asset.malware24h)}</td><td className="px-4 py-3 text-right">{asset.lastEvidenceAt?<Timestamp value={asset.lastEvidenceAt}/>:<span className="text-slate-600">None</span>}</td></tr>)}</tbody></table></div>
    </section>

    <div className="grid gap-4 lg:grid-cols-3">
      <section id="policies" className="scroll-mt-4 rounded-md border border-white/10 p-4"><div className="flex items-center gap-2"><ScanLine size={17} className="text-sky-300"/><h2 className="text-sm font-semibold text-white">Policies</h2></div><p className="mt-3 text-sm text-slate-300">{data.policies.runtimeDetector.name} v{data.policies.runtimeDetector.version}</p><p className="mt-1 text-xs text-slate-500">Runtime detector active · {data.policies.managed} managed policies</p></section>
      <section id="forensics" className="scroll-mt-4 rounded-md border border-white/10 p-4"><div className="flex items-center gap-2"><FileSearch size={17} className="text-slate-400"/><h2 className="text-sm font-semibold text-white">Forensics</h2></div><p className="mt-3 text-sm text-slate-300">{data.authorities?.find(item=>item.key==="forensics")?.state==="connected"?"Forensic manifest preview available":"Forensic authority unavailable"}</p><p className="mt-1 text-xs text-slate-500">{data.authorities?.find(item=>item.key==="forensics")?.state==="connected"?"Live-row SHA-256 fingerprint available; signed export and chain-of-custody qualification remain disabled.":"No forensic state is inferred from canonical events alone."}</p></section>
      <section id="audit" className="scroll-mt-4 rounded-md border border-white/10 p-4"><div className="flex items-center gap-2"><History size={17} className="text-fuchsia-300"/><h2 className="text-sm font-semibold text-white">Audit trail</h2></div><p className="mt-3 text-sm text-slate-300">{count(data.audit.canonicalEvents)} canonical events in view</p><p className="mt-1 text-xs text-slate-500">{data.audit.connected?`${data.audit.events.length} append-only control-plane audit records loaded.`:"Append-only response audit is not connected."}</p></section>
    </div>

    <div className="flex justify-end"><Link href="/console/migraguard/monitoring" className="inline-flex items-center gap-2 text-xs font-medium text-sky-300 hover:text-sky-200">Open monitoring and sensor coverage <ChevronRight size={15}/></Link></div>
  </>;
}

export default async function MigraGuardPage() {
  const session=await getSession();
  if(!session) redirect("/console/login");
  if(!verifyEmail(session.email)) redirect("/unauthorized");
  const result=await loadGuardCommandCenter();
  if(result.state==="forbidden") redirect("/unauthorized");
  return <ConsolePageShell session={session} activePath="/console/migraguard" title="MigraGuard" subtitle="Ecosystem Security Command Center" actions={<RefreshAlerts/>}>
    <GuardNav/>
    {result.state==="ready"?<><SecurityOverview data={result.data}/><CommandCenterView data={result.data}/></>:<CommandUnavailable state={result.state}/>}
  </ConsolePageShell>;
}
