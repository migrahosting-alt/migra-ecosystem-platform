import { redirect } from "next/navigation";
import Link from "next/link";

import { getSession } from "../../lib/auth";
import { AnnoupaleShell } from "../../components/annoupale/AnnoupaleShell";
import { SectionCard } from "../../components/SectionCard";
import { ANNOUPALE_BASE } from "../../lib/annoupale";
import {
  LivePill,
  PanelUnavailable,
  StatCard,
  pill,
  PRIORITY_TONE,
  STATUS_TONE,
  labelize,
  fmtDate,
} from "../../components/annoupale/annoupale-ui";
import { adminReasonLabel } from "../../lib/annoupale/admin-fetch";
import { loadModerationQueue } from "../../lib/annoupale/moderation";
import {
  MODERATION_STATUS_OPTIONS,
  sanitizeModerationStatus,
  type ModerationCaseRow,
} from "../../lib/annoupale/moderation-contract";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

function RiskBadge({ score }: { score: number }) {
  const tone =
    score >= 70
      ? "border-red-400/30 bg-red-500/10 text-red-300"
      : score >= 40
        ? "border-amber-400/30 bg-amber-500/10 text-amber-300"
        : "border-slate-400/20 bg-slate-500/10 text-slate-400";
  return <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium ${tone}`}>{score}</span>;
}

function ModerationTable({ cases }: { cases: ModerationCaseRow[] }) {
  if (cases.length === 0) {
    return <p className="py-8 text-center text-[12px] text-slate-500">No moderation cases match the current filters.</p>;
  }
  const th = "px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500";
  const td = "px-3 py-2 text-[12px] text-slate-300";
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-white/10">
            <th className={th}>Case</th>
            <th className={th}>Target</th>
            <th className={th}>Priority</th>
            <th className={th}>Status</th>
            <th className={th}>Risk</th>
            <th className={th}>Opened</th>
            <th className={th}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c) => (
            <tr key={c.id} className="border-b border-white/5 transition hover:bg-white/[0.02]">
              <td className={`${td} font-mono`}>{`${c.id.slice(0, 8)}…`}</td>
              <td className={td}>
                {labelize(c.targetType)}
                {c.targetId ? <span className="ml-1 font-mono text-slate-500">{c.targetId.slice(0, 8)}…</span> : null}
              </td>
              <td className={td}>
                <span className={pill(PRIORITY_TONE, c.priority)}>{c.priority}</span>
              </td>
              <td className={td}>
                <span className={pill(STATUS_TONE, c.status)}>{labelize(c.status)}</span>
              </td>
              <td className={td}>
                <RiskBadge score={c.riskScore} />
              </td>
              <td className={td}>{fmtDate(c.openedAt)}</td>
              <td className={td}>
                <a
                  href={`${ANNOUPALE_BASE}/admin/moderation`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-slate-300 hover:border-fuchsia-400/40 hover:text-white"
                >
                  Open ↗
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AnnoupaleModerationPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const session = await getSession();
  if (!session) redirect("/console/login");

  const sp = await searchParams;
  const status = sanitizeModerationStatus(first(sp.status));
  const result = await loadModerationQueue({ status });

  const sel =
    "rounded-md border border-white/10 bg-slate-900/60 px-2 py-1.5 text-[12px] text-slate-200 focus:border-fuchsia-400/40 focus:outline-none";

  return (
    <AnnoupaleShell
      session={session}
      title="Moderation"
      subtitle="Reported users, profiles, posts, groups, and pages. Read-only queue — moderation actions run in AnnouPale."
      actions={<LivePill connected={result.connected} label={result.connected ? "Live" : "Unavailable"} />}
    >
      {result.connected ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard label="Pending" accent="text-amber-300" value={result.summary.pending} hint="Open + assigned" />
            <StatCard label="High priority" accent="text-red-300" value={result.summary.highPriority} hint="High / critical" />
            <StatCard label="In view" accent="text-slate-200" value={result.summary.total} hint={result.hasMore ? "More available" : "All loaded"} />
          </div>

          <SectionCard title="Moderation queue" subtitle="Targets are referenced by internal ID — no requester PII.">
            <form method="get" action="/console/annoupale/moderation" className="mb-4 flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-slate-500">
                Status
                <select name="status" defaultValue={status ?? ""} className={sel}>
                  <option value="">All Statuses</option>
                  {MODERATION_STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{labelize(s)}</option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                className="rounded-md bg-gradient-to-r from-fuchsia-500 to-pink-500 px-4 py-1.5 text-[12px] font-semibold text-white shadow-lg shadow-fuchsia-500/30 hover:shadow-fuchsia-500/50"
              >
                Apply
              </button>
              <Link href="/console/annoupale/moderation" className="rounded-md border border-white/10 px-3 py-1.5 text-[12px] text-slate-400 hover:text-slate-200">
                Reset
              </Link>
            </form>
            <ModerationTable cases={result.cases} />
          </SectionCard>
        </>
      ) : (
        <SectionCard title="Moderation queue">
          <PanelUnavailable
            message={adminReasonLabel(result.reason)}
            fallbackHref={`${ANNOUPALE_BASE}/admin/moderation`}
            fallbackLabel="Open AnnouPale moderation admin"
          />
        </SectionCard>
      )}
    </AnnoupaleShell>
  );
}
