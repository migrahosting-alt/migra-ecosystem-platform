import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, BellRing, ChevronRight, CircleAlert, RadioTower, Server, ShieldAlert, ShieldCheck } from "lucide-react";
import { getSession, verifyEmail } from "../../lib/auth";
import { ConsolePageShell } from "../../components/ConsolePageShell";
import { loadGuardAlerts, loadGuardCoverage } from "../../lib/migraguard/data";
import { loadGuardTelemetryOverview } from "../../lib/migraguard/asset-context-data";
import { filters, presentAlert } from "../../lib/migraguard/reader";
import { AlertSummary, GuardUnavailable, Metric, Severity, Timestamp } from "../GuardView";
import { GuardNav } from "../GuardNav";
import { RefreshAlerts } from "../RefreshAlerts";

export const dynamic = "force-dynamic";
export default async function MigraGuardMonitoringPage({searchParams}: {searchParams:Promise<{severity?:string | string[];page?:string | string[]}>}) {
  const session = await getSession();
  if (!session) redirect("/console/login");
  if (!verifyEmail(session.email)) redirect("/unauthorized");
  const filter = filters(await searchParams);
  const result = await loadGuardAlerts(filter);
  const [coverage,telemetry] = await Promise.all([loadGuardCoverage(),loadGuardTelemetryOverview()]);
  if (result.state === "forbidden") redirect("/unauthorized");
  const href = (page:number) => `/console/migraguard/monitoring?severity=${filter.severity}&page=${page}`;
  const canonicalCollectors=telemetry.state==="ready" ? telemetry.data.agents.map(agent=>({
    name:agent.hostname||agent.name,
    state:agent.evidenceState==="current" ? "reporting" as const : agent.evidenceState==="stale" ? "degraded" as const : "stale" as const,
    lastSeen:agent.lastEventAt,
  })) : null;
  const collectors=canonicalCollectors || (coverage.state==="ready" ? coverage.data.collectors : []);
  const reporting=collectors.filter(item=>item.state==="reporting").length;
  const attention=collectors.filter(item=>item.state!=="reporting").length;
  const alerts=result.state==="ready" ? result.data.alerts : [];
  const critical=alerts.filter(alert=>alert.severity==="critical").length;
  const posture=canonicalCollectors
    ? (collectors.length===0 ? "unknown" : attention===0 ? "reporting" : reporting>0 ? "degraded" : "unknown")
    : coverage.state==="ready" ? coverage.data.state : "unknown";
  const coverageSource=canonicalCollectors ? "Canonical telemetry" : coverage.state==="ready" ? "Legacy compatibility" : "Unavailable";
  const postureCopy=posture==="reporting"
    ? {label:"Operational",heading:"Monitoring is reporting normally",description:"All connected collectors are reporting without a current coverage warning."}
    : posture==="degraded"
      ? {label:"Needs attention",heading:"Monitoring is active with reduced coverage",description:"MigraGuard is receiving evidence, but one or more collectors report a monitoring problem."}
      : {label:"Unknown",heading:"Monitoring status cannot be verified",description:"The console cannot currently confirm collector coverage or protection alerts."};
  return <ConsolePageShell session={session} activePath="/console/migraguard" title="Monitoring" subtitle="Sensor coverage, collector health, and protection alerts"
    actions={<RefreshAlerts />}>
    <GuardNav />
    <section aria-labelledby="posture-heading" className="overflow-hidden rounded-md border border-white/10 bg-white/[0.02]">
      <div className="flex flex-wrap items-start justify-between gap-5 border-b border-white/10 p-5">
        <div className="flex min-w-0 gap-4">
          <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-md border ${posture==="reporting" ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-300" : posture==="degraded" ? "border-amber-400/20 bg-amber-500/10 text-amber-200" : "border-rose-400/20 bg-rose-500/10 text-rose-300"}`}>
            {posture==="reporting" ? <ShieldCheck size={23}/> : <ShieldAlert size={23}/>}
          </div>
          <div><div className="flex flex-wrap items-center gap-2"><p className="text-xs font-semibold uppercase text-slate-400">Monitoring posture</p><span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-500">{coverageSource}</span></div><h2 id="posture-heading" className="mt-1 text-lg font-semibold text-white">{postureCopy.heading}</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-300">{postureCopy.description}</p>{telemetry.state==="ready"&&<p className="mt-1 text-[10px] text-slate-500">Evidence freshness evaluated at <Timestamp value={telemetry.data.evaluatedAt}/> · threshold {Math.round(telemetry.data.freshnessThresholdSeconds/60)} min</p>}</div>
        </div>
        <span className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${posture==="reporting" ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-300" : posture==="degraded" ? "border-amber-400/20 bg-amber-500/10 text-amber-200" : "border-rose-400/20 bg-rose-500/10 text-rose-300"}`}>{postureCopy.label}</span>
      </div>
      <dl className="grid divide-y divide-white/10 px-5 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
        <Metric label="Collectors reporting" value={`${reporting} / ${collectors.length || "-"}`} detail="Recent evidence received" tone={reporting===collectors.length&&collectors.length>0 ? "good" : "warning"}/>
        <Metric label="Need attention" value={canonicalCollectors||coverage.state==="ready" ? attention : "-"} detail="Collectors with reduced or missing coverage" tone={attention>0 ? "warning" : "good"}/>
        <Metric label="Alerts in this view" value={result.state==="ready" ? alerts.length : "-"} detail={`Page ${filter.page} with the current filter`} />
        <Metric label="Critical alerts" value={result.state==="ready" ? critical : "-"} detail="Highest-priority alerts on this page" tone={critical>0 ? "critical" : "neutral"}/>
      </dl>
    </section>

    <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
    {result.state !== "ready" ? <GuardUnavailable state={result.state} /> : <section aria-label="Protection alerts" className="min-w-0 overflow-hidden rounded-md border border-white/10">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2"><BellRing size={17} className="text-fuchsia-300"/><div><h2 className="text-sm font-semibold">Protection alerts</h2><p className="mt-0.5 text-xs text-slate-500">Prioritized observations that require review</p></div></div>
        <nav aria-label="Alert severity" className="flex rounded-md border border-white/10 bg-black/20 p-0.5">
          {(["all","critical","high"] as const).map(severity=><Link key={severity} href={`/console/migraguard/monitoring?severity=${severity}&page=1`} className={`rounded px-3 py-1.5 text-xs font-medium capitalize ${filter.severity===severity ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"}`}>{severity}</Link>)}
        </nav>
      </div>
      {alerts.length === 0 ? <p className="px-4 py-10 text-sm text-slate-400">No alerts match this view. This does not establish protection coverage.</p> : <ul className="divide-y divide-white/10">
        {alerts.map(alert=>{const presentation=presentAlert(alert); return <li key={alert.id}>
          <Link href={`/console/migraguard/alerts/${alert.id}`} prefetch={false} className="grid min-w-0 gap-3 px-4 py-4 transition hover:bg-white/[0.03] sm:grid-cols-[90px_minmax(0,1fr)_150px_28px] sm:items-center">
            <div><Severity severity={alert.severity}/></div>
            <AlertSummary presentation={presentation}/>
            <div className="flex items-center gap-2 text-xs text-slate-400 sm:block"><span className="sm:block">{presentation.signal}</span><span className="text-slate-600 sm:hidden">·</span><Timestamp value={alert.createdAt}/></div>
            <ChevronRight size={18} className="hidden text-slate-500 sm:block" aria-hidden="true"/>
          </Link>
        </li>})}
      </ul>}
      <nav aria-label="Alert pages" className="mt-4 flex justify-between">{filter.page>1 ? <Link href={href(filter.page-1)} aria-label="Previous page" title="Previous page" className="p-2"><ArrowLeft size={18} /></Link> : <span />}{result.data.hasNext && <Link href={href(filter.page+1)} aria-label="Next page" title="Next page" className="p-2"><ArrowRight size={18} /></Link>}</nav>
    </section>}
    <aside className="min-w-0 space-y-5">
      <section aria-label="Collector health" className="overflow-hidden rounded-md border border-white/10">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3"><Server size={17} className="text-sky-300"/><div><h2 className="text-sm font-semibold">Collector health</h2><p className="mt-0.5 text-xs text-slate-500">Monitoring coverage by system</p></div></div>
        {!canonicalCollectors&&coverage.state!=="ready" ? <p className="px-4 py-6 text-sm text-slate-400">Collector status is unavailable.</p> : <ul className="divide-y divide-white/10">{collectors.map(collector=><li key={collector.name} className="px-4 py-3"><div className="flex items-center justify-between gap-3"><span className="truncate text-sm font-medium text-white">{collector.name}</span><span className={`flex items-center gap-1.5 text-xs font-medium ${collector.state==="reporting" ? "text-emerald-300" : collector.state==="degraded" ? "text-amber-200" : "text-rose-300"}`}>{collector.state==="reporting" ? <RadioTower size={13}/> : <CircleAlert size={13}/>} {collector.state==="reporting" ? "Reporting" : collector.state==="degraded" ? "Needs attention" : "Not reporting"}</span></div>{collector.lastSeen ? <div className="mt-1"><Timestamp value={collector.lastSeen}/></div> : <p className="mt-1 text-xs text-slate-500">No recent report</p>}</li>)}</ul>}
        <p className="border-t border-white/10 px-4 py-3 text-xs leading-5 text-slate-500">{canonicalCollectors?"Canonical trust requires both recent authenticated credential use and canonical event evidence. It does not guarantee complete protection.":"Compatibility collector activity confirms evidence delivery only. It does not guarantee complete protection."}</p>
      </section>
      <section className="rounded-md border border-white/10 p-4"><div className="flex gap-3"><ShieldCheck size={18} className="mt-0.5 shrink-0 text-slate-400"/><div><h2 className="text-sm font-semibold">Response governance</h2><p className="mt-1 text-xs leading-5 text-slate-400">This console is read-only. Reviewing an alert does not authorize containment or change a protected system.</p></div></div></section>
    </aside>
    </div>
  </ConsolePageShell>;
}
