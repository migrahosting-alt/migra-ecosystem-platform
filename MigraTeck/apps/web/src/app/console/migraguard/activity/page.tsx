import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, CircleOff, Filter } from "lucide-react";
import { ConsolePageShell } from "../../components/ConsolePageShell";
import { getSession, verifyEmail } from "../../lib/auth";
import { presentCanonicalEvent } from "../../lib/migraguard/canonical";
import { loadCanonicalActivity } from "../../lib/migraguard/data";
import { GuardNav } from "../GuardNav";
import { RefreshAlerts } from "../RefreshAlerts";
import { Timestamp } from "../GuardView";

export const dynamic="force-dynamic";
const severities=["all","info","low","medium","high","critical"] as const;
type Severity=typeof severities[number];
type Search={severity?:string|string[];eventType?:string|string[];attackCategory?:string|string[];before?:string|string[]};
const single=(value:string|string[]|undefined)=>typeof value==="string"?value:"";
const bounded=(value:string|string[]|undefined)=>{const candidate=single(value).trim();return candidate.length<=100&&/^[a-zA-Z0-9._:-]*$/.test(candidate)?candidate:"";};
const validBefore=(value:string|string[]|undefined)=>{const candidate=single(value);return candidate&&Number.isFinite(Date.parse(candidate))?new Date(candidate).toISOString():"";};

function href(filters:{severity:Severity;eventType:string;attackCategory:string},before=""){
  const query=new URLSearchParams();
  if(filters.severity!=="all")query.set("severity",filters.severity);
  if(filters.eventType)query.set("eventType",filters.eventType);
  if(filters.attackCategory)query.set("attackCategory",filters.attackCategory);
  if(before)query.set("before",before);
  return `/console/migraguard/activity?${query}`;
}

export default async function MigraGuardActivityPage({searchParams}:{searchParams:Promise<Search>}){
  const session=await getSession();
  if(!session)redirect("/console/login");
  if(!verifyEmail(session.email))redirect("/unauthorized");
  const raw=await searchParams;
  const requestedSeverity=single(raw.severity);
  const severity=(severities.includes(requestedSeverity as Severity)?requestedSeverity:"all") as Severity;
  const eventType=bounded(raw.eventType),attackCategory=bounded(raw.attackCategory),before=validBefore(raw.before);
  const query={limit:51,...(severity!=="all"?{severity}:{}),...(eventType?{eventType}:{}),...(attackCategory?{attackCategory}:{}),...(before?{before}:{})};
  const result=await loadCanonicalActivity(query);
  if(result.state==="forbidden")redirect("/unauthorized");
  const rows=result.state==="ready"?result.data.slice(0,50).map(presentCanonicalEvent):[];
  const hasNext=result.state==="ready"&&result.data.length>50;
  const filters={severity,eventType,attackCategory};
  return <ConsolePageShell session={session} activePath="/console/migraguard" title="Security Activity" subtitle="Canonical tenant-scoped evidence" actions={<RefreshAlerts/>}>
    <GuardNav/>
    <form method="get" className="grid gap-3 rounded-md border border-white/10 bg-white/[0.02] p-4 md:grid-cols-[170px_1fr_1fr_auto] md:items-end">
      <label className="text-xs text-slate-400">Severity<select name="severity" defaultValue={severity} className="mt-1.5 h-9 w-full rounded-md border border-white/10 bg-slate-950 px-3 text-sm text-white">{severities.map(value=><option key={value} value={value}>{value.charAt(0).toUpperCase()+value.slice(1)}</option>)}</select></label>
      <label className="text-xs text-slate-400">Event type<input name="eventType" defaultValue={eventType} maxLength={100} placeholder="waf.blocked" className="mt-1.5 h-9 w-full rounded-md border border-white/10 bg-slate-950 px-3 text-sm text-white placeholder:text-slate-600"/></label>
      <label className="text-xs text-slate-400">Attack category<input name="attackCategory" defaultValue={attackCategory} maxLength={100} placeholder="brute_force" className="mt-1.5 h-9 w-full rounded-md border border-white/10 bg-slate-950 px-3 text-sm text-white placeholder:text-slate-600"/></label>
      <button type="submit" className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-white/10 px-4 text-sm font-medium text-white hover:bg-white/[0.05]"><Filter size={15}/>Apply</button>
    </form>
    {result.state!=="ready"?<section role="status" className="rounded-md border border-rose-400/20 bg-rose-500/[0.05] p-6"><div className="flex gap-3"><CircleOff size={20} className="mt-0.5 text-rose-300"/><div><h2 className="text-sm font-semibold text-rose-200">Canonical activity unavailable</h2><p className="mt-2 text-sm text-slate-300">MigraGuard did not substitute compatibility data or an empty result.</p></div></div></section>:
    <section className="overflow-hidden rounded-md border border-white/10"><div className="flex items-center justify-between border-b border-white/10 px-4 py-3"><div><h2 className="text-sm font-semibold text-white">Canonical security events</h2><p className="mt-1 text-xs text-slate-500">Server-classified and deduplicated evidence</p></div><span className="text-xs text-slate-500">{rows.length} shown</span></div>
      {rows.length===0?<p className="px-4 py-10 text-sm text-slate-400">No events match this bounded view. This is not a claim of safety.</p>:<div className="overflow-x-auto"><table className="min-w-[1050px] w-full text-left text-xs"><thead className="border-b border-white/10 bg-white/[0.02] text-[10px] uppercase text-slate-500"><tr><th className="px-4 py-2.5">Severity</th><th className="px-3 py-2.5">Event</th><th className="px-3 py-2.5">Source</th><th className="px-3 py-2.5">Target</th><th className="px-3 py-2.5">Detection</th><th className="px-3 py-2.5">Evidence</th><th className="px-4 py-2.5 text-right">Time</th></tr></thead><tbody className="divide-y divide-white/10">{rows.map(event=><tr key={event.id}><td className="px-4 py-3 capitalize text-slate-300">{event.severity}</td><td className="px-3 py-3"><p className="font-medium text-white">{event.title}</p><p className="mt-1 capitalize text-slate-500">{event.domain}</p></td><td className="px-3 py-3 text-slate-300">{event.source}</td><td className="px-3 py-3 text-slate-400">{event.target}</td><td className="px-3 py-3 font-mono text-[11px] text-slate-400">{event.detection}</td><td className="px-3 py-3"><details><summary className="cursor-pointer text-sky-300">Inspect</summary><ul className="mt-2 space-y-1 text-[11px] text-slate-400">{event.evidence.map(item=><li key={item}>{item}</li>)}</ul><p className="mt-2 font-mono text-[10px] text-slate-600">{event.evidenceId}</p></details></td><td className="px-4 py-3 text-right"><Timestamp value={event.timestamp}/></td></tr>)}</tbody></table></div>}
      <div className="flex items-center justify-between border-t border-white/10 px-4 py-3">{before?<Link href={href(filters)} className="inline-flex items-center gap-1 text-xs text-sky-300"><ChevronLeft size={14}/>Newest</Link>:<span/>}{hasNext&&rows.at(-1)?<Link href={href(filters,rows.at(-1)!.timestamp)} className="inline-flex items-center gap-1 text-xs text-sky-300">Older<ChevronRight size={14}/></Link>:<span className="text-xs text-slate-600">End of current result</span>}</div>
    </section>}
  </ConsolePageShell>;
}
