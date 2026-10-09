import { redirect } from "next/navigation";
import { BellRing, CircleOff, LockKeyhole, PlugZap } from "lucide-react";
import { ConsolePageShell } from "../../components/ConsolePageShell";
import { getSession, verifyEmail } from "../../lib/auth";
import { loadGuardOperatorSnapshot } from "../../lib/migraguard/data";
import { GuardNav } from "../GuardNav";
import { RefreshAlerts } from "../RefreshAlerts";
import { Timestamp } from "../GuardView";

export const dynamic="force-dynamic";

export default async function DeliveryPage(){
  const session=await getSession();
  if(!session)redirect("/console/login");
  if(!verifyEmail(session.email))redirect("/unauthorized");
  const result=await loadGuardOperatorSnapshot();
  if(result.state==="forbidden")redirect("/unauthorized");
  const data=result.state==="ready"?result.data.deliveryPosture:null;

  return <ConsolePageShell session={session} activePath="/console/migraguard" title="Delivery & Integrations" subtitle="Notification channels, integration posture, and outbound delivery health" actions={<RefreshAlerts/>}>
    <GuardNav/>
    {!data?<section className="rounded-md border border-rose-400/20 p-6"><div className="flex gap-3"><CircleOff size={20} className="text-rose-300"/><p className="text-sm text-slate-300">Delivery posture authority unavailable. No healthy or configured state is inferred.</p></div></section>:
    <>
      <section className="rounded-md border border-amber-400/20 bg-amber-500/[0.04] p-4">
        <div className="flex gap-3"><LockKeyhole size={18} className="text-amber-200"/><div><h2 className="font-semibold text-white">Read-only operator posture</h2><p className="mt-1 text-sm text-slate-400">This console cannot edit integrations, reveal configuration or credentials, test outbound destinations, or send notifications.</p></div></div>
      </section>

      <section className="grid gap-px overflow-hidden rounded-md border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-6">
        {[
          ["Integrations",data.integrations.length],
          ["Enabled",data.integrations.filter(i=>i.enabled).length],
          ["Channels",data.notificationChannels.length],
          ["Pending",data.notifications.pending],
          ["Sent",data.notifications.sent],
          ["Failed",data.notifications.failed],
        ].map(([label,value])=><div key={String(label)} className="bg-slate-950 p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold text-white">{value}</p></div>)}
      </section>

      <section className="overflow-hidden rounded-md border border-white/10">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3"><PlugZap size={17} className="text-sky-300"/><h2 className="text-sm font-semibold text-white">Integration posture</h2></div>
        {data.integrations.length===0?<p className="p-6 text-sm text-slate-400">No integrations are configured in the connected tenant.</p>:<div className="overflow-x-auto"><table className="min-w-[1000px] w-full text-left text-xs"><thead className="border-b border-white/10 text-[10px] uppercase text-slate-500"><tr><th className="px-4 py-2.5">Integration</th><th className="px-3 py-2.5">Type</th><th className="px-3 py-2.5">State</th><th className="px-3 py-2.5">Last test</th><th className="px-3 py-2.5">Last sync</th><th className="px-4 py-2.5 text-right">Updated</th></tr></thead><tbody className="divide-y divide-white/10">{data.integrations.map(row=><tr key={row.id}><td className="px-4 py-3"><p className="font-medium text-white">{row.name}</p>{row.lastTestError&&<p className="mt-1 max-w-md truncate text-[10px] text-rose-300">{row.lastTestError}</p>}</td><td className="px-3 py-3 text-slate-300">{row.type}</td><td className="px-3 py-3"><span className={row.enabled?"text-emerald-300":"text-slate-500"}>{row.enabled?"enabled":"disabled"}</span></td><td className="px-3 py-3"><p className="capitalize text-slate-300">{row.lastTestStatus||"not tested"}</p>{row.lastTestedAt&&<p className="mt-1 text-[10px] text-slate-500"><Timestamp value={row.lastTestedAt}/></p>}</td><td className="px-3 py-3">{row.lastSyncAt?<Timestamp value={row.lastSyncAt}/>:<span className="text-slate-600">—</span>}</td><td className="px-4 py-3 text-right">{row.updatedAt?<Timestamp value={row.updatedAt}/>:<Timestamp value={row.createdAt}/>}</td></tr>)}</tbody></table></div>}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
        <div className="overflow-hidden rounded-md border border-white/10">
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3"><BellRing size={17} className="text-fuchsia-300"/><h2 className="text-sm font-semibold text-white">Notification channels</h2></div>
          {data.notificationChannels.length===0?<p className="p-6 text-sm text-slate-400">No notification channels are configured.</p>:<div className="divide-y divide-white/10">{data.notificationChannels.map(row=><article key={row.id} className="flex items-center justify-between gap-4 p-4"><div><h3 className="font-medium text-white">{row.name}</h3><p className="mt-1 text-xs text-slate-500">{row.type}</p></div><div className="text-right"><p className={row.enabled?"text-xs text-emerald-300":"text-xs text-slate-500"}>{row.enabled?"enabled":"disabled"}</p><p className="mt-1 text-[10px] text-slate-600">{row.updatedAt?<Timestamp value={row.updatedAt}/>:<Timestamp value={row.createdAt}/>}</p></div></article>)}</div>}
        </div>

        <div className="rounded-md border border-white/10 p-4">
          <h2 className="text-sm font-semibold text-white">Delivery summary</h2>
          <dl className="mt-4 space-y-3 text-xs">
            {[
              ["Total records",data.notifications.total],
              ["Critical priority",data.notifications.critical],
              ["High priority",data.notifications.high],
              ["Read",data.notifications.read],
            ].map(([label,value])=><div key={String(label)} className="flex items-center justify-between gap-3 border-b border-white/10 pb-3"><dt className="text-slate-500">{label}</dt><dd className="font-medium text-white">{value}</dd></div>)}
          </dl>
          <div className="mt-4 text-xs text-slate-500">{data.notifications.latestSentAt?<p>Latest sent <Timestamp value={data.notifications.latestSentAt}/></p>:<p>No sent timestamp is available.</p>}</div>
        </div>
      </section>
    </>}
  </ConsolePageShell>;
}
