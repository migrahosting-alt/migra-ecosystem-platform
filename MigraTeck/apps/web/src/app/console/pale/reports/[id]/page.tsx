import { redirect } from "next/navigation";
import Link from "next/link";
import { ShieldCheck, Activity, ArrowLeft } from "lucide-react";

import { getSession } from "../../../lib/auth";
import { ConsolePageShell } from "../../../components/ConsolePageShell";
import { SectionCard } from "../../../components/SectionCard";
import { isPaleDbConfigured } from "../../../lib/pale-db";
import { getPaleReport, getReportEvents, type LiveAuditEvent } from "../../../lib/pale-live";
import { getPaleRole, canViewReports, maskPhone } from "../../../lib/pale-rbac";
import { maskActor, shortId, absolute } from "../../../lib/pale-dashboard";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, string> = {
  pending: "border-amber-400/20 bg-amber-500/10 text-amber-300",
  reviewing: "border-sky-400/20 bg-sky-500/10 text-sky-300",
  reviewed: "border-emerald-400/20 bg-emerald-500/10 text-emerald-300",
  dismissed: "border-slate-400/20 bg-slate-500/10 text-slate-400",
  actioned: "border-violet-400/20 bg-violet-500/10 text-violet-300",
  escalated: "border-rose-400/20 bg-rose-500/10 text-rose-300",
};
const ACTION_DOT: Record<string, string> = { danger: "bg-rose-400", ok: "bg-emerald-400", warn: "bg-amber-400" };
const tone = (a: string) => {
  const u = a.toUpperCase();
  if (u.includes("BAN") || u.includes("SUSPEND") || u.includes("DELETE")) return "danger";
  if (u.includes("RESTORE") || u.includes("RESOLVE") || u.includes("DISMISS")) return "ok";
  return "warn";
};
const prettyAction = (a: string) => a.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
/** Mask an actor that may be an email (onBehalfOf) or a username. */
const maskWho = (s: string | null): string => {
  if (!s) return "—";
  const at = s.indexOf("@");
  if (at > 0) return `${s.slice(0, 2)}•••@${s.slice(at + 1)}`;
  return maskActor(s);
};

export default async function PaleReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/console/login");
  const role = getPaleRole(session);
  if (!canViewReports(role)) redirect("/console/pale/reports");

  const { id } = await params;
  const dbConfigured = isPaleDbConfigured();
  const [report, events] = dbConfigured
    ? await Promise.all([getPaleReport(id), getReportEvents(id)])
    : [null, [] as LiveAuditEvent[]];

  return (
    <ConsolePageShell session={session} activePath="/console/pale" title="Pale — Report" subtitle="Report detail & status history (read-only)">
      <div className="-mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
        <Link href="/console/pale" className="hover:text-slate-300">Pale</Link><span>/</span>
        <Link href="/console/pale/reports" className="hover:text-slate-300">Reports</Link><span>/</span>
        <span className="font-mono text-slate-300">{shortId(id)}</span>
      </div>

      <Link href="/console/pale/reports" className="inline-flex w-fit items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to reports
      </Link>

      {!report ? (
        <SectionCard title="Report">
          <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.01] px-4 py-8 text-center text-[11px] text-slate-500">
            {dbConfigured ? "Report not found." : "Pale DB not configured."}
          </div>
        </SectionCard>
      ) : (
        <>
          <SectionCard title="Report" subtitle={`#${shortId(report.id)}`}>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
              {[
                ["Status", <span key="s" className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium ${STATUS_BADGE[report.status] ?? STATUS_BADGE.pending}`}>{report.status}</span>],
                ["Target", <span key="t" className="text-slate-200">{report.targetType} <span className="font-mono text-slate-500">{shortId(report.targetId ?? null)}</span></span>],
                ["Reporter", <span key="r" className="font-mono text-slate-400">{maskPhone(report.reporterPhone)}</span>],
                ["Created", <span key="c" className="text-slate-400">{absolute(report.createdAt)}</span>],
                ["Reason", <span key="rs" className="text-slate-300">{report.reason}</span>],
                ["Details", <span key="d" className="text-slate-400">{report.details || "—"}</span>],
              ].map(([label, val]) => (
                <div key={label as string} className="flex flex-col gap-0.5">
                  <dt className="text-[9px] font-medium uppercase tracking-wider text-slate-600">{label}</dt>
                  <dd className="text-[12px]">{val}</dd>
                </div>
              ))}
            </dl>
          </SectionCard>

          <SectionCard title="Status history" subtitle={events.length ? `${events.length} event${events.length === 1 ? "" : "s"}` : undefined}>
            {events.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.01] px-4 py-8 text-center text-[11px] text-slate-500">
                No status history yet. History starts when console review actions are used.
              </div>
            ) : (
              <ol className="relative px-1 py-1">
                <span className="absolute bottom-3 left-[7px] top-3 w-px bg-white/8" aria-hidden />
                {events.map((e, i) => (
                  <li key={i} className="relative flex gap-3 py-2.5">
                    <span className={`relative z-10 mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 rounded-full border-2 border-slate-950 ${ACTION_DOT[tone(e.action)]}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="text-[12px] font-medium text-slate-100">{prettyAction(e.action)}</span>
                        {e.status && <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-300">→ {e.status}</span>}
                        <span className="ml-auto text-[10px] text-slate-600">{absolute(e.createdAt)}</span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        by <span className="font-mono text-slate-500">{maskWho(e.onBehalfOf || e.actor)}</span>
                        {e.actorRole && <> · role <span className="text-slate-400">{e.actorRole}</span></>}
                        {e.requestId && <> · req <span className="font-mono text-slate-600">{shortId(e.requestId)}</span></>}
                      </p>
                      {e.note && <p className="mt-0.5 truncate text-[11px] text-slate-400">note: {e.note}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </SectionCard>
        </>
      )}

      <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <p className="text-[11px] leading-relaxed text-slate-400">
          Read-only detail. Status history is derived from the audit log; actors and operator identities are masked.
          No raw metadata, private content, OTPs, or full phones are shown. <Link href="/console/pale/reports/activity" className="text-fuchsia-300 hover:text-fuchsia-200"><Activity className="inline h-3 w-3" /> reviewer activity</Link>.
        </p>
      </div>
    </ConsolePageShell>
  );
}
