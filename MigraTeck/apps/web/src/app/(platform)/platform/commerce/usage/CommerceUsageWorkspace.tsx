"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  Gauge,
  Loader2,
  RefreshCw,
  RotateCw,
  Search,
  ShieldCheck,
  TriangleAlert,
  Waypoints,
  XCircle,
} from "lucide-react";

type UsageWindow = "24h" | "7d" | "30d";

type MeterDefinition = {
  productFamily: string;
  product: string;
  planCode: string;
  planName: string;
  lookupKey: string;
  meterName: string;
  metric: string;
  billingInterval: string;
  unitAmount: number | null;
};

type UsageEvent = {
  id: string;
  orgId: string;
  orgName: string;
  orgSlug: string;
  product: string;
  metric: string;
  quantity: string;
  meterName: string;
  idempotencyKey: string | null;
  source: string;
  exportStatus: string;
  exportAttempts: number;
  nextRetryAt: string | null;
  exportedAt: string | null;
  exportError: string | null;
  metadata: Record<string, unknown> | null;
  timestamp: string;
  createdAt: string;
  updatedAt: string;
};

type UsageQuota = {
  id: string;
  orgId: string;
  orgName: string;
  orgSlug: string;
  product: string;
  metric: string;
  limitValue: string;
  currentUsed: string;
  periodStart: string;
  periodEnd: string;
  updatedAt: string;
};

type Reconciliation = {
  id: string;
  orgId: string;
  type: string;
  status: string;
  findings: Record<string, unknown>;
  resolvedAt: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

type UsagePayload = {
  authority: {
    roles: string[];
    permissions: string[];
    viaBootstrap: boolean;
  };
  canManageUsage: boolean;
  window: UsageWindow;
  meterDefinitions: MeterDefinition[];
  summary: {
    billableEvents: number;
    pendingExport: number;
    failedExport: number;
    exported: number;
    localOnly: number;
    billableQuantity: string;
  };
  meterActivity: Array<{
    product: string;
    meterName: string;
    metric: string;
    events: number;
    quantity: string;
    exported: number;
    pending: number;
    failed: number;
    lastSeenAt: string | null;
  }>;
  recentEvents: UsageEvent[];
  quotas: UsageQuota[];
  exportFailures: Array<{
    id: string;
    orgId: string;
    orgName: string;
    product: string;
    meterName: string;
    quantity: string;
    exportStatus: string;
    exportAttempts: number;
    nextRetryAt: string | null;
    exportError: string | null;
    timestamp: string;
  }>;
  reconciliations: Reconciliation[];
  coverage: {
    meteredOrgs: number;
    billingCustomers: number;
    missingCustomerMappings: number;
  };
  worker: {
    ready: boolean;
    workerId: string | null;
    pid: number | null;
    lastSeenAt: string | null;
    ageMs: number | null;
  };
};

type OrganizationSummary = {
  id: string;
  name: string;
  slug: string;
  activeEntitlementCount: number;
  subscriptionCount: number;
};

const PRODUCT_KEYS = [
  "MIGRATECK",
  "MIGRAHOSTING",
  "MIGRAPANEL",
  "MIGRAVOICE",
  "MIGRAMAIL",
  "MIGRAINTAKE",
  "MIGRAMARKET",
  "MIGRAPILOT",
  "MIGRAINVOICE",
  "MIGRADRIVE",
  "MIGRABUILDER",
];

const USAGE_METRICS = [
  "API_CALLS",
  "STORAGE_BYTES",
  "BANDWIDTH_BYTES",
  "SEATS",
  "EMAILS_SENT",
  "SMS_SENT",
  "BUILDS",
  "DEPLOYMENTS",
  "VPS_HOURS",
  "CUSTOM",
];

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function formatBigInt(value: string | number) {
  try {
    return BigInt(String(value)).toLocaleString();
  } catch {
    return String(value);
  }
}

function localInputValue(date: Date) {
  const copy = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return copy.toISOString().slice(0, 16);
}

function defaultPeriod() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return {
    periodStart: localInputValue(start),
    periodEnd: localInputValue(end),
  };
}

function exportStatusClass(status: string) {
  if (status === "EXPORTED") return "bg-emerald-50 text-emerald-700";
  if (status === "FAILED") return "bg-rose-50 text-rose-700";
  if (status === "RETRY") return "bg-amber-50 text-amber-700";
  if (status === "RUNNING") return "bg-blue-50 text-blue-700";
  if (status === "PENDING_EXPORT") return "bg-violet-50 text-violet-700";
  return "bg-slate-100 text-slate-600";
}

export function CommerceUsageWorkspace() {
  const [usageWindow, setUsageWindow] = useState<UsageWindow>("24h");
  const [data, setData] = useState<UsagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyEvent, setBusyEvent] = useState<string | null>(null);
  const [busyReport, setBusyReport] = useState<string | null>(null);

  const defaults = useMemo(() => defaultPeriod(), []);
  const [orgQuery, setOrgQuery] = useState("");
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [orgSearching, setOrgSearching] = useState(false);
  const [quotaOrg, setQuotaOrg] = useState<OrganizationSummary | null>(null);
  const [quotaProduct, setQuotaProduct] = useState("MIGRAHOSTING");
  const [quotaMetric, setQuotaMetric] = useState("CUSTOM");
  const [quotaLimit, setQuotaLimit] = useState("");
  const [periodStart, setPeriodStart] = useState(defaults.periodStart);
  const [periodEnd, setPeriodEnd] = useState(defaults.periodEnd);
  const [quotaSaving, setQuotaSaving] = useState(false);
  const [quotaMessage, setQuotaMessage] = useState<string | null>(null);

  const load = useCallback(async (selected: UsageWindow, background = false) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        "/api/platform/commerce/usage?window=" + encodeURIComponent(selected),
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? body.message ?? "Unable to load usage operations");
      }
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load usage operations");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(usageWindow);
  }, [load, usageWindow]);

  useEffect(() => {
    if (!orgQuery.trim()) {
      setOrganizations([]);
      return;
    }

    const timer = globalThis.setTimeout(async () => {
      setOrgSearching(true);
      try {
        const response = await fetch(
          "/api/platform/commerce/organizations?q=" +
            encodeURIComponent(orgQuery.trim()) +
            "&limit=12",
          { cache: "no-store" },
        );
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Unable to search organizations");
        setOrganizations(body.organizations ?? []);
      } catch (err) {
        setQuotaMessage(err instanceof Error ? err.message : "Unable to search organizations");
      } finally {
        setOrgSearching(false);
      }
    }, 280);

    return () => globalThis.clearTimeout(timer);
  }, [orgQuery]);

  const meterCards = useMemo(() => {
    if (!data) return [];
    const grouped = new Map<
      string,
      {
        product: string;
        productFamily: string;
        meterName: string;
        metric: string;
        plans: Array<{ planCode: string; planName: string; lookupKey: string }>;
      }
    >();

    for (const definition of data.meterDefinitions) {
      const key = definition.product + ":" + definition.meterName;
      const current = grouped.get(key) ?? {
        product: definition.product,
        productFamily: definition.productFamily,
        meterName: definition.meterName,
        metric: definition.metric,
        plans: [],
      };
      current.plans.push({
        planCode: definition.planCode,
        planName: definition.planName,
        lookupKey: definition.lookupKey,
      });
      grouped.set(key, current);
    }

    return [...grouped.values()];
  }, [data]);

  async function retryEvent(eventId: string) {
    setBusyEvent(eventId);
    setError(null);
    try {
      const response = await fetch(
        "/api/platform/commerce/usage/events/" +
          encodeURIComponent(eventId) +
          "/retry",
        { method: "POST" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to retry usage export");
      await load(usageWindow, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to retry usage export");
    } finally {
      setBusyEvent(null);
    }
  }

  async function resolveReport(reportId: string) {
    const note = globalThis.prompt?.("Resolution note (optional):") ?? "";
    setBusyReport(reportId);
    setError(null);
    try {
      const response = await fetch(
        "/api/platform/commerce/usage/reconciliation/" +
          encodeURIComponent(reportId) +
          "/resolve",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: note.trim() || null }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to resolve reconciliation report");
      await load(usageWindow, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to resolve reconciliation report");
    } finally {
      setBusyReport(null);
    }
  }

  async function saveQuota() {
    if (!quotaOrg) {
      setQuotaMessage("Select an organization first.");
      return;
    }
    if (!/^\d+$/.test(quotaLimit.trim())) {
      setQuotaMessage("Quota limit must be a non-negative whole number.");
      return;
    }

    setQuotaSaving(true);
    setQuotaMessage(null);
    try {
      const response = await fetch(
        "/api/platform/commerce/usage/quotas/" +
          encodeURIComponent(quotaOrg.id) +
          "/" +
          encodeURIComponent(quotaProduct) +
          "/" +
          encodeURIComponent(quotaMetric),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            limitValue: quotaLimit.trim(),
            periodStart: new Date(periodStart).toISOString(),
            periodEnd: new Date(periodEnd).toISOString(),
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to save usage quota");
      setQuotaMessage("Quota saved and audited.");
      await load(usageWindow, true);
    } catch (err) {
      setQuotaMessage(err instanceof Error ? err.message : "Unable to save usage quota");
    } finally {
      setQuotaSaving(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="grid min-h-72 place-items-center rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 text-sm font-medium text-slate-600">
          <Loader2 size={18} className="animate-spin text-blue-600" />
          Loading usage operations…
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <section className="rounded-3xl border border-rose-200 bg-rose-50 p-6">
        <h2 className="font-semibold text-rose-950">Usage operations unavailable</h2>
        <p className="mt-2 text-sm leading-6 text-rose-800">
          {error ?? "Platform commerce authority is required."}
        </p>
        <button
          onClick={() => void load(usageWindow)}
          className="mt-4 inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-800"
        >
          <RefreshCw size={15} /> Retry
        </button>
      </section>
    );
  }

  const openReports = data.reconciliations.filter((report) => report.status === "OPEN");

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
          {error}
        </div>
      ) : null}

      {data.authority.viaBootstrap ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This session is using MigraAuth bootstrap authority. Persistent platform-role grants should replace bootstrap authority.
        </div>
      ) : null}

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Observation window
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
              Commercial meter pipeline
            </h2>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="grid grid-cols-3 rounded-xl border border-slate-200 bg-slate-50 p-1">
              {(["24h", "7d", "30d"] as UsageWindow[]).map((option) => (
                <button
                  key={option}
                  onClick={() => setUsageWindow(option)}
                  className={
                    "rounded-lg px-3 py-2 text-xs font-semibold transition " +
                    (usageWindow === option
                      ? "bg-white text-slate-950 shadow-sm"
                      : "text-slate-500 hover:text-slate-800")
                  }
                >
                  {option}
                </button>
              ))}
            </div>
            <button
              onClick={() => void load(usageWindow, true)}
              disabled={refreshing}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          icon={<Activity size={17} />}
          label="Billable events"
          value={data.summary.billableEvents.toLocaleString()}
          detail={formatBigInt(data.summary.billableQuantity) + " total units"}
        />
        <MetricCard
          icon={<Clock3 size={17} />}
          label="Pending export"
          value={data.summary.pendingExport.toLocaleString()}
          detail="queued or retrying"
        />
        <MetricCard
          icon={<CheckCircle2 size={17} />}
          label="Exported"
          value={data.summary.exported.toLocaleString()}
          detail="accepted by Stripe meter API"
        />
        <MetricCard
          icon={<XCircle size={17} />}
          label="Failed"
          value={data.summary.failedExport.toLocaleString()}
          detail={openReports.length + " open reconciliation reports"}
        />
        <MetricCard
          icon={<ShieldCheck size={17} />}
          label="Worker"
          value={data.worker.ready ? "Ready" : "Not ready"}
          detail={data.worker.lastSeenAt ? "Heartbeat " + formatDate(data.worker.lastSeenAt) : "No heartbeat"}
          good={data.worker.ready}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.12fr_0.88fr]">
        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
              Canonical meter registry
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
              Source-defined meters
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Meter names and plan lookup keys come from the source-controlled catalog. The operator does not invent processor rates.
            </p>
          </div>
          <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-6">
            {meterCards.map((meter) => {
              const activity = data.meterActivity.find(
                (item) =>
                  item.product === meter.product &&
                  item.meterName === meter.meterName,
              );
              return (
                <article
                  key={meter.product + ":" + meter.meterName}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-slate-900">
                        {meter.product}
                      </p>
                      <code className="mt-1 block text-[11px] font-semibold text-blue-700">
                        {meter.meterName}
                      </code>
                    </div>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-slate-500">
                      {meter.metric}
                    </span>
                  </div>
                  <div className="mt-3 space-y-1.5">
                    {meter.plans.map((plan) => (
                      <div
                        key={plan.lookupKey}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2"
                      >
                        <p className="text-[11px] font-semibold text-slate-700">
                          {plan.planName}
                        </p>
                        <code className="mt-0.5 block truncate text-[9px] text-slate-400">
                          {plan.lookupKey}
                        </code>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500">
                    <span>{activity?.events ?? 0} events</span>
                    <span>{formatBigInt(activity?.quantity ?? "0")} units</span>
                    <span>{activity?.failed ?? 0} failed</span>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <div className="space-y-6">
          <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">
                Pipeline coverage
              </p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
                Billing customer readiness
              </h2>
            </div>
            <div className="space-y-4 p-5 sm:p-6">
              <div className="grid grid-cols-3 gap-2">
                <MiniStat label="Metered orgs" value={data.coverage.meteredOrgs} />
                <MiniStat label="Stripe customers" value={data.coverage.billingCustomers} />
                <MiniStat
                  label="Missing mapping"
                  value={data.coverage.missingCustomerMappings}
                  danger={data.coverage.missingCustomerMappings > 0}
                />
              </div>
              {data.coverage.missingCustomerMappings > 0 ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">
                  <div className="flex items-center gap-2 font-semibold">
                    <TriangleAlert size={14} />
                    Customer mapping gap
                  </div>
                  <p className="mt-1">
                    Metered organizations without a Stripe BillingCustomer mapping cannot export. Those events fail closed and create reconciliation evidence.
                  </p>
                </div>
              ) : (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs leading-5 text-emerald-800">
                  Every metered organization currently has a Stripe customer mapping.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">
                Quota operator
              </p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
                Create or change a quota
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Usage counters update in the same transaction as new billable events.
              </p>
            </div>
            <div className="space-y-4 p-5 sm:p-6">
              {!data.canManageUsage ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-600">
                  Read-only. Platform commerce usage management permission is required to change quotas or retry exports.
                </div>
              ) : (
                <>
                  <div className="relative">
                    <label className="text-sm font-semibold text-slate-800">
                      Organization
                    </label>
                    <div className="relative mt-2">
                      <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        value={quotaOrg ? quotaOrg.name : orgQuery}
                        onChange={(event) => {
                          setQuotaOrg(null);
                          setOrgQuery(event.target.value);
                        }}
                        placeholder="Search organization…"
                        className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm text-slate-900 outline-none focus:border-emerald-400 focus:bg-white"
                      />
                      {orgSearching ? (
                        <Loader2 size={14} className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-slate-400" />
                      ) : null}
                    </div>
                    {!quotaOrg && organizations.length > 0 ? (
                      <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
                        {organizations.map((org) => (
                          <button
                            key={org.id}
                            onClick={() => {
                              setQuotaOrg(org);
                              setOrgQuery("");
                              setOrganizations([]);
                            }}
                            className="block w-full rounded-lg px-3 py-2 text-left hover:bg-slate-50"
                          >
                            <p className="text-sm font-semibold text-slate-800">{org.name}</p>
                            <p className="text-[10px] text-slate-400">{org.slug}</p>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-semibold text-slate-800">
                      Product
                      <select
                        value={quotaProduct}
                        onChange={(event) => setQuotaProduct(event.target.value)}
                        className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
                      >
                        {PRODUCT_KEYS.map((product) => (
                          <option key={product} value={product}>{product}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm font-semibold text-slate-800">
                      Metric
                      <select
                        value={quotaMetric}
                        onChange={(event) => setQuotaMetric(event.target.value)}
                        className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
                      >
                        {USAGE_METRICS.map((metric) => (
                          <option key={metric} value={metric}>{metric}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <label className="block text-sm font-semibold text-slate-800">
                    Limit
                    <input
                      value={quotaLimit}
                      onChange={(event) => setQuotaLimit(event.target.value)}
                      inputMode="numeric"
                      placeholder="10000"
                      className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm"
                    />
                  </label>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-semibold text-slate-800">
                      Period start
                      <input
                        type="datetime-local"
                        value={periodStart}
                        onChange={(event) => setPeriodStart(event.target.value)}
                        className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
                      />
                    </label>
                    <label className="text-sm font-semibold text-slate-800">
                      Period end
                      <input
                        type="datetime-local"
                        value={periodEnd}
                        onChange={(event) => setPeriodEnd(event.target.value)}
                        className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
                      />
                    </label>
                  </div>

                  {quotaMessage ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700">
                      {quotaMessage}
                    </div>
                  ) : null}

                  <button
                    onClick={() => void saveQuota()}
                    disabled={quotaSaving}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {quotaSaving ? <Loader2 size={15} className="animate-spin" /> : <Gauge size={15} />}
                    {quotaSaving ? "Saving…" : "Save quota"}
                  </button>
                </>
              )}
            </div>
          </section>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Active limits
          </p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
            Organization quotas
          </h2>
        </div>
        {data.quotas.length === 0 ? (
          <EmptyState
            icon={<Gauge size={20} />}
            title="No active usage quotas"
            detail="Without a quota row the metric is treated as unlimited. Product-level entitlements may still impose their own limits."
          />
        ) : (
          <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-6 xl:grid-cols-3">
            {data.quotas.map((quota) => {
              const used = Number(quota.currentUsed);
              const limit = Number(quota.limitValue);
              const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
              return (
                <article key={quota.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{quota.orgName}</p>
                      <p className="mt-1 text-[10px] text-slate-400">{quota.orgSlug}</p>
                    </div>
                    <span className="text-xs font-semibold text-slate-700">{pct.toFixed(1)}%</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-semibold text-slate-600">{quota.product}</span>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-semibold text-slate-600">{quota.metric}</span>
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-slate-900" style={{ width: pct + "%" }} />
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                    <span>{formatBigInt(quota.currentUsed)} used</span>
                    <span>{formatBigInt(quota.limitValue)} limit</span>
                  </div>
                  <p className="mt-2 text-[10px] text-slate-400">Ends {formatDate(quota.periodEnd)}</p>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Ledger evidence
          </p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
            Recent billable usage events
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Idempotent product usage only. API request telemetry remains local-only and is intentionally excluded here.
          </p>
        </div>
        {data.recentEvents.length === 0 ? (
          <EmptyState
            icon={<Waypoints size={20} />}
            title="No billable usage events yet"
            detail="Products begin appearing here after they report canonical meter events with an API key holding usage:write."
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {data.recentEvents.map((event) => (
              <article key={event.id} className="p-5 sm:px-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={"rounded-full px-2 py-0.5 text-[10px] font-bold " + exportStatusClass(event.exportStatus)}>
                        {event.exportStatus}
                      </span>
                      <span className="text-sm font-semibold text-slate-900">{event.orgName}</span>
                      <code className="text-[11px] font-semibold text-blue-700">{event.meterName}</code>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span>{event.product}</span>
                      <span>{formatBigInt(event.quantity)} units</span>
                      <span>{event.exportAttempts} export attempts</span>
                      <span>{formatDate(event.timestamp)}</span>
                    </div>
                    {event.exportError ? (
                      <p className="mt-2 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-800">
                        {event.exportError}
                      </p>
                    ) : null}
                    <code className="mt-2 block truncate text-[10px] text-slate-400">
                      {event.idempotencyKey ?? event.id}
                    </code>
                  </div>
                  {data.canManageUsage && ["FAILED", "RETRY"].includes(event.exportStatus) ? (
                    <button
                      onClick={() => void retryEvent(event.id)}
                      disabled={busyEvent === event.id}
                      className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-blue-200 px-3.5 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                    >
                      {busyEvent === event.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCw size={14} />}
                      Retry export
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-600">
            Reconciliation
          </p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
            Export failures & operator findings
          </h2>
        </div>
        {data.reconciliations.length === 0 ? (
          <EmptyState
            icon={<Database size={20} />}
            title="No reconciliation findings"
            detail="Terminal export failures create durable reconciliation reports here instead of disappearing into worker logs."
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {data.reconciliations.map((report) => {
              const findings = report.findings ?? {};
              const message =
                typeof findings.message === "string"
                  ? findings.message
                  : JSON.stringify(findings);
              return (
                <article key={report.id} className="p-5 sm:px-6">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={"rounded-full px-2 py-0.5 text-[10px] font-bold " + (report.status === "OPEN" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700")}>
                          {report.status}
                        </span>
                        <span className="text-sm font-semibold text-slate-900">{report.type}</span>
                      </div>
                      <p className="mt-2 max-w-3xl text-xs leading-5 text-slate-600">{message}</p>
                      <p className="mt-2 text-[10px] text-slate-400">{formatDate(report.createdAt)}</p>
                    </div>
                    {data.canManageUsage && report.status === "OPEN" ? (
                      <button
                        onClick={() => void resolveReport(report.id)}
                        disabled={busyReport === report.id}
                        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-emerald-200 px-3.5 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                      >
                        {busyReport === report.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                        Resolve
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  good,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  good?: boolean;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className={good ? "text-emerald-600" : "text-slate-500"}>{icon}</div>
      <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
    </article>
  );
}

function MiniStat({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className={"mt-1 text-lg font-semibold " + (danger ? "text-rose-700" : "text-slate-900")}>{value}</p>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="grid min-h-44 place-items-center p-8 text-center">
      <div>
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-slate-100 text-slate-500">
          {icon}
        </span>
        <h3 className="mt-3 text-sm font-semibold text-slate-900">{title}</h3>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{detail}</p>
      </div>
    </div>
  );
}
