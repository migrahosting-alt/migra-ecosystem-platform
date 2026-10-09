"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  BadgeDollarSign,
  ChevronLeft,
  ChevronRight,
  CircleCheckBig,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react";

type Kind =
  | "subscription_payment_risk"
  | "invoice_open_balance"
  | "invoice_uncollectible"
  | "stripe_webhook_failed"
  | "stripe_webhook_stalled"
  | "billing_identity_missing"
  | "billing_identity_mismatch";

type Severity = "critical" | "warning";

type RevenueException = {
  kind: Kind;
  severity: Severity;
  orgId: string | null;
  orgName: string | null;
  orgSlug: string | null;
  entityType: string;
  entityId: string;
  occurredAt: string | null;
  evidence: Record<string, unknown>;
};

type Payload = {
  total: number;
  limit: number;
  offset: number;
  summary: {
    critical: number;
    warning: number;
    newestAt: string | null;
    oldestAt: string | null;
  };
  byKind: Record<Kind, number>;
  exceptions: RevenueException[];
};

const kindOptions: Array<{ value: "" | Kind; label: string }> = [
  { value: "", label: "All exceptions" },
  { value: "subscription_payment_risk", label: "Subscription payment risk" },
  { value: "invoice_open_balance", label: "Open invoice balance" },
  { value: "invoice_uncollectible", label: "Uncollectible invoice" },
  { value: "stripe_webhook_failed", label: "Failed Stripe ingestion" },
  { value: "stripe_webhook_stalled", label: "Stalled Stripe ingestion" },
  { value: "billing_identity_missing", label: "Missing billing identity" },
  { value: "billing_identity_mismatch", label: "Billing identity mismatch" },
];

function kindLabel(kind: Kind) {
  return kindOptions.find((option) => option.value === kind)?.label ?? kind;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

function formatEvidenceValue(key: string, value: unknown) {
  if (
    typeof value === "number" &&
    ["total", "amountPaid", "amountRemaining"].includes(key)
  ) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value / 100);
  }
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "—";
  return JSON.stringify(value);
}

export function RevenueExceptionsWorkspace() {
  const [data, setData] = useState<Payload | null>(null);
  const [kind, setKind] = useState<"" | Kind>("");
  const [severity, setSeverity] = useState<"" | Severity>("");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: "50",
        offset: String(offset),
      });
      if (kind) params.set("kind", kind);
      if (severity) params.set("severity", severity);
      if (appliedQuery) params.set("q", appliedQuery);

      const response = await fetch(
        "/api/platform/commerce/revenue-exceptions?" + params.toString(),
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Unable to load revenue exceptions");
      }
      setData(body);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load revenue exceptions",
      );
    } finally {
      setLoading(false);
    }
  }, [kind, severity, appliedQuery, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeFilters = useMemo(
    () => [kind, severity, appliedQuery].filter(Boolean).length,
    [kind, severity, appliedQuery],
  );
  const pageStart = data?.total ? data.offset + 1 : 0;
  const pageEnd = data
    ? Math.min(data.total, data.offset + data.exceptions.length)
    : 0;
  const canBack = (data?.offset ?? 0) > 0;
  const canNext = data ? data.offset + data.limit < data.total : false;

  function applySearch() {
    setOffset(0);
    setAppliedQuery(query.trim());
  }

  function clearFilters() {
    setKind("");
    setSeverity("");
    setQuery("");
    setAppliedQuery("");
    setOffset(0);
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Active exceptions"
          value={data?.total.toLocaleString() ?? "—"}
          detail="Derived from canonical billing evidence"
        />
        <Metric
          label="Critical"
          value={data?.summary.critical.toLocaleString() ?? "—"}
          detail="Identity, processor, bad-debt, or payment-risk evidence"
          tone="critical"
        />
        <Metric
          label="Warning"
          value={data?.summary.warning.toLocaleString() ?? "—"}
          detail="Open receivables or stalled ingestion evidence"
          tone="warning"
        />
        <Metric
          label="Evidence window"
          value={data?.summary.newestAt ? "Active" : "No rows"}
          detail={
            data?.summary.newestAt
              ? formatDate(data.summary.oldestAt) +
                " → " +
                formatDate(data.summary.newestAt)
              : "No exception evidence is currently present"
          }
        />
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-950">
                Exception queue
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                This surface never performs payment, refund, invoice write-off,
                or subscription mutation actions.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <label>
              <span className="text-xs font-semibold text-slate-600">
                Search
              </span>
              <div className="relative mt-1.5">
                <Search
                  size={15}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") applySearch();
                  }}
                  placeholder="Organization, entity, exception kind…"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-blue-400 focus:bg-white"
                />
              </div>
            </label>

            <label>
              <span className="text-xs font-semibold text-slate-600">Kind</span>
              <select
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value as "" | Kind);
                  setOffset(0);
                }}
                className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
              >
                {kindOptions.map((option) => (
                  <option key={option.label} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="text-xs font-semibold text-slate-600">
                Severity
              </span>
              <select
                value={severity}
                onChange={(event) => {
                  setSeverity(event.target.value as "" | Severity);
                  setOffset(0);
                }}
                className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
              >
                <option value="">All severities</option>
                <option value="critical">Critical</option>
                <option value="warning">Warning</option>
              </select>
            </label>

            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={applySearch}
                className="h-10 rounded-xl bg-blue-600 px-4 text-xs font-semibold text-white"
              >
                Apply
              </button>
              {activeFilters ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="h-10 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700"
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {error ? (
          <div className="m-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            {error}
          </div>
        ) : null}

        {loading && !data ? (
          <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 size={17} className="animate-spin" />
            Loading revenue exceptions…
          </div>
        ) : data?.exceptions.length ? (
          <div className="divide-y divide-slate-100">
            {data.exceptions.map((item) => (
              <article
                key={item.kind + ":" + item.entityId}
                className="p-5 sm:p-6"
              >
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={item.severity} />
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-600">
                        {kindLabel(item.kind)}
                      </span>
                    </div>
                    <h3 className="mt-3 text-sm font-semibold text-slate-950">
                      {item.orgName ?? "Platform processor evidence"}
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">
                      {item.orgSlug ? item.orgSlug + " · " : ""}
                      {item.entityType} ·{" "}
                      <code className="text-[11px]">{item.entityId}</code>
                    </p>
                  </div>
                  <div className="shrink-0 text-left xl:text-right">
                    <p className="text-xs text-slate-500">
                      {formatDate(item.occurredAt)}
                    </p>
                    <Link
                      href="/platform/billing"
                      className="mt-2 inline-flex items-center text-xs font-semibold text-blue-600"
                    >
                      Open billing operations
                    </Link>
                  </div>
                </div>

                {Object.keys(item.evidence).length ? (
                  <div className="mt-4 grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-2 xl:grid-cols-4">
                    {Object.entries(item.evidence).map(([key, value]) => (
                      <div key={key} className="min-w-0">
                        <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                          {key}
                        </p>
                        <code className="mt-1 block break-all text-[11px] text-slate-700">
                          {formatEvidenceValue(key, value)}
                        </code>
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="p-8">
            <div className="mx-auto max-w-2xl rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
              <div className="flex items-start gap-3">
                <CircleCheckBig
                  size={19}
                  className="mt-0.5 shrink-0 text-emerald-700"
                />
                <div>
                  <p className="text-sm font-semibold text-emerald-950">
                    No revenue exceptions detected
                  </p>
                  <p className="mt-1 text-xs leading-5 text-emerald-800">
                    The canonical billing ledger currently contains no matching
                    payment-risk, receivable, ingestion, or identity-drift
                    evidence. This does not imply billing activity exists; use
                    MigraPay & Billing to verify account and activity evidence.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3 border-t border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">
            {data && data.total
              ? "Showing " +
                pageStart +
                "-" +
                pageEnd +
                " of " +
                data.total.toLocaleString()
              : "No exception rows"}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!canBack || loading}
              onClick={() =>
                setOffset(
                  Math.max(0, (data?.offset ?? 0) - (data?.limit ?? 50)),
                )
              }
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold disabled:opacity-40"
            >
              <ChevronLeft size={14} />
              Previous
            </button>
            <button
              type="button"
              disabled={!canNext || loading}
              onClick={() =>
                setOffset((data?.offset ?? 0) + (data?.limit ?? 50))
              }
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold disabled:opacity-40"
            >
              Next
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <KindCard
          icon={<ShieldAlert size={16} />}
          label="Payment & bad debt"
          value={
            (data?.byKind.subscription_payment_risk ?? 0) +
            (data?.byKind.invoice_uncollectible ?? 0)
          }
        />
        <KindCard
          icon={<BadgeDollarSign size={16} />}
          label="Open receivables"
          value={data?.byKind.invoice_open_balance ?? 0}
        />
        <KindCard
          icon={<AlertTriangle size={16} />}
          label="Stripe ingestion"
          value={
            (data?.byKind.stripe_webhook_failed ?? 0) +
            (data?.byKind.stripe_webhook_stalled ?? 0)
          }
        />
        <KindCard
          icon={<ShieldAlert size={16} />}
          label="Identity drift"
          value={
            (data?.byKind.billing_identity_missing ?? 0) +
            (data?.byKind.billing_identity_mismatch ?? 0)
          }
        />
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "critical" | "warning";
}) {
  const valueClass =
    tone === "critical"
      ? "text-rose-700"
      : tone === "warning"
        ? "text-amber-700"
        : "text-slate-950";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        {label}
      </p>
      <p className={"mt-2 text-xl font-semibold " + valueClass}>{value}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className={
        "rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] " +
        (severity === "critical"
          ? "bg-rose-50 text-rose-700"
          : "bg-amber-50 text-amber-700")
      }
    >
      {severity}
    </span>
  );
}

function KindCard({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-600">
        {icon}
      </span>
      <div>
        <p className="text-xs font-semibold text-slate-600">{label}</p>
        <p className="mt-0.5 text-lg font-semibold text-slate-950">
          {value.toLocaleString()}
        </p>
      </div>
    </div>
  );
}
