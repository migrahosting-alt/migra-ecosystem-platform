import { redirect } from "next/navigation";
import Link from "next/link";

import { getSession } from "../../lib/auth";
import { AnnoupaleShell } from "../../components/annoupale/AnnoupaleShell";
import { SectionCard } from "../../components/SectionCard";
import { ANNOUPALE_LINKS } from "../../lib/annoupale";
import {
  LivePill,
  PanelUnavailable,
  pill,
  PRIORITY_TONE,
  STATUS_TONE,
  labelize,
  fmtDate,
} from "../../components/annoupale/annoupale-ui";
import { loadAppeals } from "../../lib/annoupale/compliance-appeals";
import {
  reasonLabel,
  sanitizePage,
  sanitizePriority,
  sanitizeStatus,
  STATUS_OPTIONS,
  type ComplianceCaseRow,
} from "../../lib/annoupale/compliance-contract";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

function hrefFor(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const s = qs.toString();
  return `/console/annoupale/appeals${s ? `?${s}` : ""}`;
}

function AppealsTable({ cases }: { cases: ComplianceCaseRow[] }) {
  if (cases.length === 0) {
    return <p className="py-8 text-center text-[12px] text-slate-500">No appeals match the current filters.</p>;
  }
  const th = "px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500";
  const td = "px-3 py-2 text-[12px] text-slate-300";
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-white/10">
            <th className={th}>Case ID</th>
            <th className={th}>Type</th>
            <th className={th}>Priority</th>
            <th className={th}>Status</th>
            <th className={th}>Created</th>
            <th className={th}>Assigned</th>
            <th className={th}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c) => {
            const detailHref = `/console/annoupale/compliance/${encodeURIComponent(c.caseId)}`;
            return (
              <tr key={c.id} className="border-b border-white/5 transition hover:bg-white/[0.02]">
                <td className={`${td} font-mono`}>
                  <Link href={detailHref} className="text-fuchsia-300 hover:text-fuchsia-200">
                    {c.caseId}
                  </Link>
                </td>
                <td className={td}>{labelize(c.requestType)}</td>
                <td className={td}>
                  <span className={pill(PRIORITY_TONE, c.priority)}>{c.priority}</span>
                </td>
                <td className={td}>
                  <span className={pill(STATUS_TONE, c.status)}>{labelize(c.status)}</span>
                </td>
                <td className={td}>{fmtDate(c.createdAt)}</td>
                <td className={td}>{c.assignedTo || <span className="text-slate-600">Unassigned</span>}</td>
                <td className={td}>
                  <Link
                    href={detailHref}
                    className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-slate-300 hover:border-fuchsia-400/40 hover:text-white"
                  >
                    Review
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function AnnoupaleAppealsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const session = await getSession();
  if (!session) redirect("/console/login");

  const sp = await searchParams;
  const status = sanitizeStatus(first(sp.status));
  const priority = sanitizePriority(first(sp.priority));
  const page = sanitizePage(first(sp.page));

  const result = await loadAppeals({ status, priority, page });
  const sel =
    "rounded-md border border-white/10 bg-slate-900/60 px-2 py-1.5 text-[12px] text-slate-200 focus:border-fuchsia-400/40 focus:outline-none";

  return (
    <AnnoupaleShell
      session={session}
      title="Appeals"
      subtitle="User appeals of enforcement actions, submitted via the appeals flow. Review-only — decisions are recorded against the underlying case."
      actions={<LivePill connected={result.connected} label={result.connected ? "Live" : "Unavailable"} />}
    >
      {result.connected ? (
        <SectionCard
          title="Appeals queue"
          subtitle={`${result.total} appeal${result.total === 1 ? "" : "s"} · ${result.summary.open} open / pending · ${result.summary.waiting} waiting on user`}
        >
          <form method="get" action="/console/annoupale/appeals" className="mb-4 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-slate-500">
              Status
              <select name="status" defaultValue={status ?? ""} className={sel}>
                <option value="">All Statuses</option>
                {STATUS_OPTIONS.map((s) => (
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
            <Link href="/console/annoupale/appeals" className="rounded-md border border-white/10 px-3 py-1.5 text-[12px] text-slate-400 hover:text-slate-200">
              Reset
            </Link>
          </form>

          <AppealsTable cases={result.cases} />

          <div className="mt-4 flex items-center justify-between text-[11px] text-slate-500">
            <span>Showing {result.cases.length} of {result.total} · page {result.page}</span>
            <span className="flex gap-2">
              {result.page > 1 && (
                <Link className="rounded border border-white/10 px-2 py-1 hover:text-slate-200" href={hrefFor({ status, priority, page: String(result.page - 1) })}>
                  ← Prev
                </Link>
              )}
              {result.page * result.limit < result.total && (
                <Link className="rounded border border-white/10 px-2 py-1 hover:text-slate-200" href={hrefFor({ status, priority, page: String(result.page + 1) })}>
                  Next →
                </Link>
              )}
            </span>
          </div>
        </SectionCard>
      ) : (
        <SectionCard title="Appeals queue">
          <PanelUnavailable
            message={reasonLabel(result.reason)}
            fallbackHref={ANNOUPALE_LINKS.adminAppeals}
            fallbackLabel="Open AnnouPale appeals admin"
          />
        </SectionCard>
      )}
    </AnnoupaleShell>
  );
}
