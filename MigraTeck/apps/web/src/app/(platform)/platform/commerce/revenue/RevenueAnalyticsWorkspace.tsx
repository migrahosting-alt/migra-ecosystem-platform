"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  Activity,
  AlertTriangle,
  BadgeDollarSign,
  ChartNoAxesCombined,
  CircleCheckBig,
  CreditCard,
  Loader2,
  RefreshCw,
} from "lucide-react";

type WindowDays = 30 | 90 | 180 | 365;
type ActivityState = "empty" | "identity_only" | "observed";

type CurrencyInvoiceEvidence = {
  currency: string;
  invoiceCount: number;
  finalizedInvoiceCount: number;
  paidInvoiceCount: number;
  openInvoiceCount: number;
  uncollectibleInvoiceCount: number;
  finalizedAmount: number;
  amountPaid: number;
  openAmount: number;
  uncollectibleAmount: number;
};

type AgingBucket = {
  invoiceCount: number;
  amount: number;
};

type AgingCurrency = {
  currency: string;
  unfinalized: AgingBucket;
  "0_30": AgingBucket;
  "31_60": AgingBucket;
  "61_90": AgingBucket;
  "91_plus": AgingBucket;
};

type Payload = {
  windowDays: WindowDays;
  evidence: {
    activityState: ActivityState;
    customerCount: number;
    billingOrganizationCount: number;
    subscriptionCount: number;
    invoiceCount: number;
    orgStateCount: number;
    webhookEventCount: number;
    earliestAt: string | null;
    latestAt: string | null;
  };
  invoices: {
    accountingBasis: "operational_invoice_evidence";
    revenueRecognition: false;
    byCurrency: CurrencyInvoiceEvidence[];
  };
  receivables: {
    ageBasis: "invoice_finalized_at";
    dueDateAvailable: false;
    byCurrency: AgingCurrency[];
  };
  subscriptions: {
    total: number;
    byStatus: Array<{
      status: string;
      subscriptionCount: number;
      cancelAtPeriodEndCount: number;
    }>;
  };
  processor: {
    evidenceAvailable: boolean;
    eventCount: number;
    receivedLast24h: number;
    failedLast24h: number;
    processedLast24h: number;
    stalledTotal: number;
    latestReceivedAt: string | null;
    latestProcessedAt: string | null;
  };
  trend: Array<{
    period: string;
    currency: string;
    invoiceCount: number;
    finalizedInvoiceCount: number;
    finalizedAmount: number;
    amountPaid: number;
    openAmount: number;
  }>;
};

const windowOptions: Array<{ value: WindowDays; label: string }> = [
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 180, label: "180 days" },
  { value: 365, label: "365 days" },
];

const agingBuckets: Array<{
  key: keyof Omit<AgingCurrency, "currency">;
  label: string;
}> = [
  { key: "unfinalized", label: "Unfinalized" },
  { key: "0_30", label: "0–30 days" },
  { key: "31_60", label: "31–60 days" },
  { key: "61_90", label: "61–90 days" },
  { key: "91_plus", label: "91+ days" },
];

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "No evidence";
}

function formatMoney(cents: number, currency: string) {
  if (currency === "unknown") {
    return cents.toLocaleString() + " minor units";
  }

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return (
      (cents / 100).toLocaleString(undefined, {
        maximumFractionDigits: 2,
      }) +
      " " +
      currency.toUpperCase()
    );
  }
}

function currencyLabel(currency: string) {
  return currency === "unknown" ? "Unknown currency" : currency.toUpperCase();
}

export function RevenueAnalyticsWorkspace() {
  const [windowDays, setWindowDays] = useState<WindowDays>(180);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        "/api/platform/commerce/revenue-analytics?windowDays=" + windowDays,
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Unable to load revenue analytics");
      }
      setData(body as Payload);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load revenue analytics",
      );
    } finally {
      setLoading(false);
    }
  }, [windowDays]);

  useEffect(() => {
    void load();
  }, [load]);

  const invoiceEvidenceAvailable = (data?.evidence.invoiceCount ?? 0) > 0;
  const trendMax = useMemo(
    () =>
      Math.max(
        1,
        ...(data?.trend.map((row) =>
          Math.max(row.finalizedAmount, row.amountPaid, row.openAmount),
        ) ?? []),
      ),
    [data?.trend],
  );

  if (loading && !data) {
    return (
      <div className="flex min-h-72 items-center justify-center gap-2 rounded-3xl border border-slate-200 bg-white text-sm text-slate-500 shadow-sm">
        <Loader2 size={18} className="animate-spin" />
        Loading canonical billing evidence…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      {data ? <EvidenceStateBanner data={data} /> : null}

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              Evidence controls
            </p>
            <h2 className="mt-1 text-base font-semibold text-slate-950">
              Operational billing window
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
              The selected window affects invoice trend rows only. Current
              balances, ledger coverage, subscription state, and processor
              posture remain global.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                Trend window
              </span>
              <select
                value={windowDays}
                onChange={(event) =>
                  setWindowDays(Number(event.target.value) as WindowDays)
                }
                className="mt-1.5 h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700"
              >
                {windowOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Metric
          label="Billing organizations"
          value={
            data?.evidence.billingOrganizationCount.toLocaleString() ?? "—"
          }
          detail="Organizations represented by canonical billing records"
        />
        <Metric
          label="Billing identities"
          value={data?.evidence.customerCount.toLocaleString() ?? "—"}
          detail="Canonical BillingCustomer records"
        />
        <Metric
          label="Invoices"
          value={data?.evidence.invoiceCount.toLocaleString() ?? "—"}
          detail={
            invoiceEvidenceAvailable
              ? "Invoice evidence available"
              : "No invoice evidence is currently stored"
          }
        />
        <Metric
          label="Subscriptions"
          value={data?.evidence.subscriptionCount.toLocaleString() ?? "—"}
          detail="Canonical subscription ledger rows"
        />
        <Metric
          label="Processor events"
          value={data?.evidence.webhookEventCount.toLocaleString() ?? "—"}
          detail="Canonical Stripe webhook evidence"
        />
        <Metric
          label="Evidence window"
          value={data?.evidence.latestAt ? "Observed" : "No rows"}
          detail={
            data?.evidence.latestAt
              ? formatDate(data.evidence.earliestAt) +
                " → " +
                formatDate(data.evidence.latestAt)
              : "No billing evidence timestamps are available"
          }
        />
      </section>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-100 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-950">
              Invoice evidence by currency
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Finalized invoice amount, invoice amount paid, open balance, and
              uncollectible balance are operational ledger evidence. They are
              not accounting revenue recognition.
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-blue-50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-blue-700">
            Currency isolated
          </span>
        </div>

        {data?.invoices.byCurrency.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-[920px] w-full text-left">
              <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                <tr>
                  <th className="px-5 py-3">Currency</th>
                  <th className="px-4 py-3">Invoices</th>
                  <th className="px-4 py-3">Finalized</th>
                  <th className="px-4 py-3">Amount paid</th>
                  <th className="px-4 py-3">Open balance</th>
                  <th className="px-4 py-3">Uncollectible</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.invoices.byCurrency.map((row) => (
                  <tr key={row.currency} className="text-sm text-slate-700">
                    <td className="px-5 py-4 font-semibold text-slate-950">
                      {currencyLabel(row.currency)}
                    </td>
                    <td className="px-4 py-4">
                      {row.invoiceCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-medium text-slate-900">
                        {formatMoney(row.finalizedAmount, row.currency)}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {row.finalizedInvoiceCount.toLocaleString()} finalized
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-medium text-slate-900">
                        {formatMoney(row.amountPaid, row.currency)}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {row.paidInvoiceCount.toLocaleString()} paid invoices
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-medium text-amber-700">
                        {formatMoney(row.openAmount, row.currency)}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {row.openInvoiceCount.toLocaleString()} open
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-medium text-rose-700">
                        {formatMoney(row.uncollectibleAmount, row.currency)}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {row.uncollectibleInvoiceCount.toLocaleString()}{" "}
                        invoices
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<CreditCard size={18} />}
            title="No invoice amount evidence"
            detail="The canonical invoice ledger has no rows. Amounts are intentionally unavailable rather than displayed as $0."
          />
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 p-5">
          <div className="flex items-center gap-2">
            <ChartNoAxesCombined size={17} className="text-blue-600" />
            <h2 className="text-base font-semibold text-slate-950">
              Open-balance aging
            </h2>
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Aging uses time since invoice finalization because the canonical
            ledger does not store a contractual due date. These bands are not
            days past due.
          </p>
        </div>

        {data?.receivables.byCurrency.length ? (
          <div className="space-y-4 p-5">
            {data.receivables.byCurrency.map((row) => (
              <article
                key={row.currency}
                className="rounded-2xl border border-slate-200 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-950">
                    {currencyLabel(row.currency)}
                  </p>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                    invoice finalization age
                  </span>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  {agingBuckets.map((bucket) => {
                    const value = row[bucket.key];
                    return (
                      <div
                        key={bucket.key}
                        className="rounded-xl bg-slate-50 p-3"
                      >
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                          {bucket.label}
                        </p>
                        <p className="mt-2 text-sm font-semibold text-slate-950">
                          {formatMoney(value.amount, row.currency)}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {value.invoiceCount.toLocaleString()} invoice
                          {value.invoiceCount === 1 ? "" : "s"}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<BadgeDollarSign size={18} />}
            title="No open receivable aging evidence"
            detail="No open invoice balances are present in the canonical ledger, so no aging bands are rendered."
          />
        )}
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-5">
            <div className="flex items-center gap-2">
              <Activity size={17} className="text-blue-600" />
              <h2 className="text-base font-semibold text-slate-950">
                Subscription state
              </h2>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              Canonical subscription rows grouped by processor status.
            </p>
          </div>
          {data?.subscriptions.byStatus.length ? (
            <div className="divide-y divide-slate-100">
              {data.subscriptions.byStatus.map((row) => (
                <div
                  key={row.status}
                  className="flex items-center justify-between gap-4 px-5 py-4"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-950">
                      {row.status.replaceAll("_", " ")}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {row.cancelAtPeriodEndCount.toLocaleString()} cancel at
                      period end
                    </p>
                  </div>
                  <p className="text-lg font-semibold text-slate-950">
                    {row.subscriptionCount.toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Activity size={18} />}
              title="No subscription ledger evidence"
              detail="No subscription rows are currently available to classify."
            />
          )}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-5">
            <div className="flex items-center gap-2">
              <CircleCheckBig size={17} className="text-blue-600" />
              <h2 className="text-base font-semibold text-slate-950">
                Stripe ingestion evidence
              </h2>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              Processor posture is derived only from canonical webhook-event
              records.
            </p>
          </div>
          {data?.processor.evidenceAvailable ? (
            <div className="grid gap-3 p-5 sm:grid-cols-2">
              <SmallMetric
                label="Received · 24h"
                value={data.processor.receivedLast24h}
              />
              <SmallMetric
                label="Processed · 24h"
                value={data.processor.processedLast24h}
              />
              <SmallMetric
                label="Failed · 24h"
                value={data.processor.failedLast24h}
                tone={data.processor.failedLast24h ? "critical" : "default"}
              />
              <SmallMetric
                label="Stalled"
                value={data.processor.stalledTotal}
                tone={data.processor.stalledTotal ? "warning" : "default"}
              />
              <div className="sm:col-span-2 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                Latest received:{" "}
                <strong>{formatDate(data.processor.latestReceivedAt)}</strong>
                <br />
                Latest processed:{" "}
                <strong>{formatDate(data.processor.latestProcessedAt)}</strong>
              </div>
            </div>
          ) : (
            <EmptyState
              icon={<AlertTriangle size={18} />}
              title="Processor ingestion health is unknown"
              detail="No Stripe webhook ledger evidence is present. Zero recorded failures must not be interpreted as a healthy processor path."
            />
          )}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-100 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-950">
              Invoice evidence trend
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Finalized invoice amount, amount paid, and open balance observed
              during the selected {data?.windowDays ?? windowDays}-day window.
            </p>
          </div>
          <span className="text-xs font-semibold text-slate-500">
            {data?.trend.length.toLocaleString() ?? "0"} period/currency rows
          </span>
        </div>

        {data?.trend.length ? (
          <div className="divide-y divide-slate-100">
            {data.trend.map((row) => (
              <div
                key={row.period + ":" + row.currency}
                className="grid gap-4 p-5 lg:grid-cols-[120px_100px_1fr]"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-950">
                    {row.period}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {row.invoiceCount.toLocaleString()} invoices
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    {currencyLabel(row.currency)}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {row.finalizedInvoiceCount.toLocaleString()} finalized
                  </p>
                </div>
                <div className="space-y-2">
                  <TrendBar
                    label="Finalized"
                    value={row.finalizedAmount}
                    max={trendMax}
                    display={formatMoney(row.finalizedAmount, row.currency)}
                  />
                  <TrendBar
                    label="Amount paid"
                    value={row.amountPaid}
                    max={trendMax}
                    display={formatMoney(row.amountPaid, row.currency)}
                  />
                  <TrendBar
                    label="Open"
                    value={row.openAmount}
                    max={trendMax}
                    display={formatMoney(row.openAmount, row.currency)}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<ChartNoAxesCombined size={18} />}
            title="No invoice trend evidence"
            detail="The selected window contains no canonical invoice rows. The interface does not fabricate zero-value periods."
          />
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-slate-950 p-5 text-slate-200 shadow-sm">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-300">
          Control-plane guardrail
        </p>
        <p className="mt-2 text-sm font-semibold text-white">
          Read-only operational evidence, not accounting revenue recognition.
        </p>
        <p className="mt-1 max-w-4xl text-xs leading-5 text-slate-400">
          This surface never initiates charges, refunds, credits, invoice
          write-offs, forced collections, or subscription changes. Financial
          mutations remain in their owning systems with separate accounting and
          reconciliation contracts.
        </p>
      </section>
    </div>
  );
}

function EvidenceStateBanner({ data }: { data: Payload }) {
  if (data.evidence.activityState === "identity_only") {
    return (
      <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-700" />
          <div>
            <p className="text-sm font-semibold text-amber-950">
              Identity-only billing evidence
            </p>
            <p className="mt-1 max-w-4xl text-sm leading-6 text-amber-800">
              Billing identity or state records exist, but the canonical ledger
              has no transactional invoice, subscription, or processor-event
              evidence. This does not mean revenue is $0; it means a revenue
              amount cannot be supported by the current evidence.
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (data.evidence.activityState === "empty") {
    return (
      <section className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
        <p className="text-sm font-semibold text-slate-900">
          No canonical billing evidence
        </p>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          No billing identity, invoice, subscription, state, or processor-event
          rows are currently present. Financial values remain unavailable.
        </p>
      </section>
    );
  }

  const hasProcessorConcern =
    data.processor.failedLast24h > 0 || data.processor.stalledTotal > 0;

  return (
    <section
      className={
        "rounded-3xl border p-5 " +
        (hasProcessorConcern
          ? "border-amber-200 bg-amber-50"
          : "border-emerald-200 bg-emerald-50")
      }
    >
      <div className="flex items-start gap-3">
        {hasProcessorConcern ? (
          <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-700" />
        ) : (
          <CircleCheckBig
            size={20}
            className="mt-0.5 shrink-0 text-emerald-700"
          />
        )}
        <div>
          <p
            className={
              "text-sm font-semibold " +
              (hasProcessorConcern ? "text-amber-950" : "text-emerald-950")
            }
          >
            Transactional billing evidence observed
          </p>
          <p
            className={
              "mt-1 max-w-4xl text-sm leading-6 " +
              (hasProcessorConcern ? "text-amber-800" : "text-emerald-800")
            }
          >
            Canonical invoice, subscription, or processor-event records are
            available. Amounts below remain operational invoice evidence and are
            not treated as recognized revenue.
          </p>
        </div>
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold text-slate-950">{value}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
    </div>
  );
}

function SmallMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "warning" | "critical";
}) {
  const valueClass =
    tone === "critical"
      ? "text-rose-700"
      : tone === "warning"
        ? "text-amber-700"
        : "text-slate-950";

  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
        {label}
      </p>
      <p className={"mt-1 text-lg font-semibold " + valueClass}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  detail,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="p-6">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-slate-500 shadow-sm">
            {icon}
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-950">{title}</p>
            <p className="mt-1 text-xs leading-5 text-slate-600">{detail}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrendBar({
  label,
  value,
  max,
  display,
}: {
  label: string;
  value: number;
  max: number;
  display: string;
}) {
  const width = Math.max(0, Math.min(100, (value / max) * 100));

  return (
    <div className="grid grid-cols-[90px_1fr_auto] items-center gap-3">
      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">
        {label}
      </span>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-blue-500"
          style={{ width: width + "%" }}
        />
      </div>
      <span className="min-w-24 text-right text-xs font-semibold text-slate-700">
        {display}
      </span>
    </div>
  );
}
