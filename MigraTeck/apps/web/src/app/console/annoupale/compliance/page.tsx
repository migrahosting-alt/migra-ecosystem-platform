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
import { loadComplianceQueue } from "../../lib/annoupale/compliance";
import {
  CATEGORY_OPTIONS,
  PRIORITY_OPTIONS,
  SEVERITY_OPTIONS,
  STATUS_OPTIONS,
  isLikelyCaseId,
  reasonLabel,
  sanitizeCategory,
  sanitizeDate,
  sanitizePage,
  sanitizePriority,
  sanitizeSearch,
  sanitizeSeverity,
  sanitizeStatus,
  type ComplianceCaseRow,
  type ComplianceSummary,
} from "../../lib/annoupale/compliance-contract";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

type Filters = {
  status?: string | undefined;
  category?: string | undefined;
  priority?: string | undefined;
  severity?: string | undefined;
  search?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
};

function hrefFor(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const s = qs.toString();
  return `/console/annoupale/compliance${s ? `?${s}` : ""}`;
}

function Tabs({
  summary,
  f,
}: {
  summary: ComplianceSummary;
  f: Filters;
}) {
  const tabs: Array<{ label: string; count: number; params: Record<string, string | undefined>; active: boolean; tone: string }> = [
    {
      label: "Open",
      count: summary.open,
      params: { status: "open", search: f.search },
      active: f.status === "open" && !f.priority,
      tone: "text-emerald-300",
    },
    {
      label: "Urgent",
      count: summary.urgent,
      params: { priority: "urgent", search: f.search },
      active: f.priority === "urgent",
      tone: "text-red-300",
    },
    {
      label: "High Priority",
      count: summary.high,
      params: { priority: "high", search: f.search },
      active: f.priority === "high",
      tone: "text-amber-300",
    },
    {
      label: "Waiting on User",
      count: summary.waiting,
      params: { status: "waiting_on_user", search: f.search },
      active: f.status === "waiting_on_user",
      tone: "text-sky-300",
    },
    {
      label: "Closed",
      count: summary.closed,
      params: { status: "closed", search: f.search },
      active: f.status === "closed",
      tone: "text-slate-400",
    },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {tabs.map((t) => (
        <Link
          key={t.label}
          href={hrefFor(t.params)}
          className={[
            "flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px] font-medium transition",
            t.active
              ? "border-fuchsia-400/40 bg-fuchsia-500/10 text-white"
              : "border-white/10 bg-white/[0.02] text-slate-300 hover:border-white/20 hover:bg-white/5",
          ].join(" ")}
        >
          <span>{t.label}</span>
          <span className={`rounded-md bg-black/30 px-1.5 py-0.5 text-[11px] font-semibold ${t.tone}`}>
            {t.count}
          </span>
        </Link>
      ))}
    </div>
  );
}

function FilterBar({ f }: { f: Filters }) {
  const sel =
    "rounded-md border border-white/10 bg-slate-900/60 px-2 py-1.5 text-[12px] text-slate-200 focus:border-fuchsia-400/40 focus:outline-none";
  return (
    <form method="get" action="/console/annoupale/compliance" className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-slate-500">
        Status
        <select name="status" defaultValue={f.status ?? ""} className={sel}>
          <option value="">All Statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{labelize(s)}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-slate-500">
        Category
        <select name="category" defaultValue={f.category ?? ""} className={sel}>
          <option value="">All Categories</option>
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c} value={c}>{labelize(c)}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-slate-500">
        Priority
        <select name="priority" defaultValue={f.priority ?? ""} className={sel}>
          <option value="">All Priorities</option>
          {PRIORITY_OPTIONS.map((p) => (
            <option key={p} value={p}>{labelize(p)}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-slate-500">
        Severity
        <select name="severity" defaultValue={f.severity ?? ""} className={sel}>
          <option value="">All Severities</option>
          {SEVERITY_OPTIONS.map((s) => (
            <option key={s} value={s}>{labelize(s)}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-slate-500">
        From
        <input type="date" name="dateFrom" defaultValue={f.dateFrom ?? ""} className={sel} />
      </label>
      <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-slate-500">
        To
        <input type="date" name="dateTo" defaultValue={f.dateTo ?? ""} className={sel} />
      </label>
      <label className="flex flex-1 flex-col gap-1 text-[10px] uppercase tracking-wide text-slate-500">
        Search
        <input
          type="search"
          name="q"
          defaultValue={f.search ?? ""}
          placeholder="Case ID, requester, or handle…"
          className={`${sel} min-w-[180px]`}
        />
      </label>
      <button
        type="submit"
        className="rounded-md bg-gradient-to-r from-fuchsia-500 to-pink-500 px-4 py-1.5 text-[12px] font-semibold text-white shadow-lg shadow-fuchsia-500/30 transition hover:shadow-fuchsia-500/50"
      >
        Apply
      </button>
      <Link
        href="/console/annoupale/compliance"
        className="rounded-md border border-white/10 px-3 py-1.5 text-[12px] text-slate-400 hover:text-slate-200"
      >
        Reset
      </Link>
    </form>
  );
}

function CaseTable({ cases }: { cases: ComplianceCaseRow[] }) {
  if (cases.length === 0) {
    return (
      <p className="py-8 text-center text-[12px] text-slate-500">
        No cases match the current filters.
      </p>
    );
  }
  const th = "px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500";
  const td = "px-3 py-2 text-[12px] text-slate-300";
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-white/10">
            <th className={th}>Case ID</th>
            <th className={th}>Category</th>
            <th className={th}>Type</th>
            <th className={th}>Priority</th>
            <th className={th}>Severity</th>
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
                <td className={td}>{labelize(c.category)}</td>
                <td className={td}>{labelize(c.requestType)}</td>
                <td className={td}>
                  <span className={pill(PRIORITY_TONE, c.priority)}>{c.priority}</span>
                </td>
                <td className={td}>{c.severity}</td>
                <td className={td}>
                  <span className={pill(STATUS_TONE, c.status)}>{labelize(c.status)}</span>
                </td>
                <td className={td}>{fmtDate(c.createdAt)}</td>
                <td className={td}>
                  {c.assignedTo || <span className="text-slate-600">Unassigned</span>}
                </td>
                <td className={td}>
                  <Link
                    href={detailHref}
                    className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-slate-300 hover:border-fuchsia-400/40 hover:text-white"
                  >
                    View
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

export default async function AnnoupaleCompliancePage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const session = await getSession();
  if (!session) redirect("/console/login");

  const sp = await searchParams;
  const f: Filters = {
    status: sanitizeStatus(first(sp.status)),
    category: sanitizeCategory(first(sp.category)),
    priority: sanitizePriority(first(sp.priority)),
    severity: sanitizeSeverity(first(sp.severity)),
    search: sanitizeSearch(first(sp.q)),
    dateFrom: sanitizeDate(first(sp.dateFrom)),
    dateTo: sanitizeDate(first(sp.dateTo)),
  };
  const page = sanitizePage(first(sp.page));

  const result = await loadComplianceQueue({ ...f, page });
  const attention = result.connected ? result.summary.urgent + result.summary.high : null;

  const pageParams: Record<string, string | undefined> = {
    status: f.status,
    category: f.category,
    priority: f.priority,
    severity: f.severity,
    q: f.search,
    dateFrom: f.dateFrom,
    dateTo: f.dateTo,
  };

  return (
    <AnnoupaleShell
      session={session}
      title="Compliance Case Queue"
      subtitle="Privacy, safety, security, IP, and appeal requests submitted by users."
      attentionCount={attention}
      defaultQuery={f.search}
      actions={<LivePill connected={result.connected} label={result.connected ? "Live" : "Unavailable"} />}
    >
      {result.connected ? (
        <>
          {f.search && isLikelyCaseId(f.search) && (
            <Link
              href={`/console/annoupale/compliance/${encodeURIComponent(f.search)}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-fuchsia-400/30 bg-fuchsia-500/[0.07] px-4 py-3 text-[12px] text-slate-200 transition hover:border-fuchsia-400/50"
            >
              <span>
                <span className="font-medium text-white">“{f.search}” looks like a case ID.</span>{" "}
                Open the case directly.
              </span>
              <span className="shrink-0 text-fuchsia-300">Open case →</span>
            </Link>
          )}

          <Tabs summary={result.summary} f={f} />

          <SectionCard
            title="Compliance queue"
            subtitle={`${result.total} case${result.total === 1 ? "" : "s"} · requester PII shown only on the case detail`}
          >
            <div className="mb-4">
              <FilterBar f={f} />
            </div>
            <CaseTable cases={result.cases} />

            <div className="mt-4 flex items-center justify-between text-[11px] text-slate-500">
              <span>
                Showing {result.cases.length} of {result.total} · page {result.page}
              </span>
              <span className="flex gap-2">
                {result.page > 1 && (
                  <Link
                    className="rounded border border-white/10 px-2 py-1 hover:text-slate-200"
                    href={hrefFor({ ...pageParams, page: String(result.page - 1) })}
                  >
                    ← Prev
                  </Link>
                )}
                {result.page * result.limit < result.total && (
                  <Link
                    className="rounded border border-white/10 px-2 py-1 hover:text-slate-200"
                    href={hrefFor({ ...pageParams, page: String(result.page + 1) })}
                  >
                    Next →
                  </Link>
                )}
              </span>
            </div>
          </SectionCard>
        </>
      ) : (
        <SectionCard title="Compliance queue">
          <PanelUnavailable
            message={reasonLabel(result.reason)}
            fallbackHref={ANNOUPALE_LINKS.complianceCases}
            fallbackLabel="Open AnnouPale compliance admin"
          />
        </SectionCard>
      )}
    </AnnoupaleShell>
  );
}
