import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CheckCircle2, ChevronRight, FileKey2, LockKeyhole, Radar, ShieldAlert } from "lucide-react";
import { getSession, verifyEmail } from "../../../lib/auth";
import { ConsolePageShell } from "../../../components/ConsolePageShell";
import { loadGuardAlert } from "../../../lib/migraguard/data";
import { presentAlert, UUID } from "../../../lib/migraguard/reader";
import { GuardUnavailable, Severity, Timestamp } from "../../GuardView";
import { GuardNav } from "../../GuardNav";

export const dynamic = "force-dynamic";
export default async function MigraGuardAlertPage({params}: {params:Promise<{id:string}>}) {
  const session = await getSession();
  if (!session) redirect("/console/login");
  if (!verifyEmail(session.email)) redirect("/unauthorized");
  const {id} = await params;
  if (!UUID.test(id)) notFound();
  const result = await loadGuardAlert(id);
  if (result.state === "forbidden") redirect("/unauthorized");
  if (result.state === "ready" && !result.data) notFound();
  const alert = result.state === "ready" ? result.data : null;
  const presentation=alert ? presentAlert(alert) : null;
  return <ConsolePageShell session={session} activePath="/console/migraguard" title="Alert review" subtitle="MigraGuard security operations"
    actions={<Link href="/console/migraguard/monitoring" aria-label="Back to alerts" title="Back to alerts" className="p-2"><ArrowLeft size={18} /></Link>}>
    <GuardNav />
    {!alert || !presentation ? <GuardUnavailable state={result.state} /> : <>
      <section className="overflow-hidden rounded-md border border-white/10 bg-white/[0.02]">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 p-5">
          <div className="flex min-w-0 gap-4"><div className={`grid h-11 w-11 shrink-0 place-items-center rounded-md border ${alert.severity==="critical" ? "border-rose-400/20 bg-rose-500/10 text-rose-300" : "border-amber-400/20 bg-amber-500/10 text-amber-200"}`}><ShieldAlert size={22}/></div><div><div className="flex flex-wrap items-center gap-2"><Severity severity={alert.severity}/><span className="text-xs text-slate-500">{presentation.signal}</span></div><h2 className="mt-2 break-words text-xl font-semibold text-white">{presentation.title}</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{presentation.summary}</p></div></div>
          <Timestamp value={alert.createdAt}/>
        </div>
        <div className="p-5"><p className="text-xs font-semibold uppercase text-slate-400">Recommended next step</p><p className="mt-2 text-sm leading-6 text-white">{presentation.nextStep}</p><p className="mt-2 text-xs leading-5 text-slate-500">This is an authenticated collector observation. It is not, by itself, independent confirmation that a system was compromised.</p></div>
      </section>

      <section aria-labelledby="chain-heading" className="rounded-md border border-white/10">
        <div className="border-b border-white/10 px-4 py-3"><h2 id="chain-heading" className="text-sm font-semibold">Verification chain</h2><p className="mt-0.5 text-xs text-slate-500">How this alert reached the operator console</p></div>
        <ol className="grid divide-y divide-white/10 md:grid-cols-3 md:divide-x md:divide-y-0">
          <li className="flex gap-3 p-4"><Radar size={18} className="mt-0.5 shrink-0 text-sky-300"/><div><p className="text-sm font-medium text-white">Evidence received</p><p className="mt-1 text-xs leading-5 text-slate-400">An authenticated collector submitted the observation.</p><Timestamp value={alert.receivedAt}/></div></li>
          <li className="flex gap-3 p-4"><FileKey2 size={18} className="mt-0.5 shrink-0 text-fuchsia-300"/><div><p className="text-sm font-medium text-white">Policy evaluated</p><p className="mt-1 text-xs leading-5 text-slate-400">Server policy classified the trusted signal and severity.</p><p className="mt-1 text-xs text-slate-500">Policy version {alert.policyVersion}</p></div></li>
          <li className="flex gap-3 p-4"><CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-300"/><div><p className="text-sm font-medium text-white">Alert persisted</p><p className="mt-1 text-xs leading-5 text-slate-400">The alert and its evidence relationship were stored for review.</p><Timestamp value={alert.createdAt}/></div></li>
        </ol>
      </section>

      <section className="rounded-md border border-white/10 p-4"><div className="flex gap-3"><LockKeyhole size={18} className="mt-0.5 shrink-0 text-slate-400"/><div><h2 className="text-sm font-semibold">Response controls are read-only</h2><p className="mt-1 text-sm leading-6 text-slate-400">Opening this alert does not authorize containment or modify a protected system. Governed response controls are not enabled in this console.</p></div></div></section>

      <details className="group rounded-md border border-white/10">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-white"><span>Technical evidence</span><ChevronRight size={17} className="text-slate-500 transition group-open:rotate-90"/></summary>
        <div className="border-t border-white/10 px-4 pb-4"><dl className="grid gap-x-6 sm:grid-cols-2">
          {[["Alert ID",alert.id],["Evidence ID",alert.evidenceId],["Agent ID",alert.agentId],["Credential ID",alert.credentialId],["Event type",alert.eventType],["Detector",alert.detector],["Policy version",String(alert.policyVersion)],["Evidence received",alert.receivedAt]].map(([label,value])=><div key={label} className="min-w-0 border-b border-white/5 py-3"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-all font-mono text-xs text-slate-200">{value}</dd></div>)}
        </dl></div>
      </details>
    </>}
  </ConsolePageShell>;
}
