import { redirect } from "next/navigation";
import Link from "next/link";
import { ShieldCheck, ArrowLeft } from "lucide-react";

import { getSession } from "../../../lib/auth";
import { ConsolePageShell } from "../../../components/ConsolePageShell";
import { SectionCard } from "../../../components/SectionCard";
import { isPaleDbConfigured } from "../../../lib/pale-db";
import { getModerationActivity, type LiveAuditEvent } from "../../../lib/pale-live";
import { getPaleRole, canViewReports } from "../../../lib/pale-rbac";
import { maskActor, shortId, absolute } from "../../../lib/pale-dashboard";

export const dynamic = "force-dynamic";

const ACTION_DOT: Record<string, string> = { danger: "bg-rose-400", ok: "bg-emerald-400", warn: "bg-amber-400" };
const tone = (a: string) => {
  const u = a.toUpperCase();
  if (u.includes("BAN") || u.includes("SUSPEND") || u.includes("DELETE")) return "danger";
  if (u.includes("RESTORE") || u.includes("RESOLVE") || u.includes("DISMISS")) return "ok";
  return "warn";
};
const prettyAction = (a: string) => a.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const maskWho = (s: string | null): string => {
  if (!s) return "—";
  const at = s.indexOf("@");
  if (at > 0) return `${s.slice(0, 2)}•••@${s.slice(at + 1)}`;
  return maskActor(s);
};

export default async function PaleReviewerActivityPage() {
  const session = await getSession();
  if (!session) redirect("/console/login");
  const role = getPaleRole(session);
  if (!canViewReports(role)) redirect("/console/pale/reports");

  const dbConfigured = isPaleDbConfigured();
  const events: LiveAuditEvent[] = dbConfigured ? await getModerationActivity(30) : [];

  return (
    <ConsolePageShell session={session} activePath="/console/pale" title="Pale — Reviewer activity" subtitle="Recent moderation actions (read-only, masked)">
      <div className="-mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
        <Link href="/console/pale" className="hover:text-slate-300">Pale</Link><span>/</span>
        <Link href="/console/pale/reports" className="hover:text-slate-300">Reports</Link><span>/</span>
        <span className="text-slate-300">Activity</span>
      </div>

      <Link href="/console/pale/reports" className="inline-flex w-fit items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to reports
      </Link>

      <SectionCard title="Reviewer activity" subtitle={dbConfigured ? `${events.length} recent` : undefined}>
        {!dbConfigured ? (
          <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.01] px-4 py-8 text-center text-[11px] text-slate-500">
            Pale DB not configured — no activity.
          </div>
        ) : events.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.01] px-4 py-8 text-center text-[11px] text-slate-500">
            No moderation activity yet. Actions appear here when reviewers use console review actions.
          </div>
        ) : (
          <ol className="relative px-1 py-1">
            <span className="absolute bottom-3 left-[7px] top-3 w-px bg-white/8" aria-hidden />
            {events.map((e, i) => {
              const isReport = e.targetType === "report" && e.targetId;
              return (
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
                      {e.actorRole && <> · {e.actorRole}</>}
                      {" · "}
                      {e.targetType ? (
                        isReport ? (
                          <Link href={`/console/pale/reports/${e.targetId}`} className="font-mono text-fuchsia-300 hover:text-fuchsia-200">{e.targetType} {shortId(e.targetId)}</Link>
                        ) : (
                          <span className="font-mono text-slate-500">{e.targetType} {shortId(e.targetId)}</span>
                        )
                      ) : null}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </SectionCard>

      <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <p className="text-[11px] leading-relaxed text-slate-400">
          Read-only activity from the audit log. Actors and operator identities are masked; no raw metadata, private
          content, OTPs, secrets, or full phones are shown.
        </p>
      </div>
    </ConsolePageShell>
  );
}
