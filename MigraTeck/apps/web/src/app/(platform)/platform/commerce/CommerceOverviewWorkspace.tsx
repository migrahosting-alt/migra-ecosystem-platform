"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BadgeDollarSign,
  Boxes,
  CheckCircle2,
  CreditCard,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Waypoints,
} from "lucide-react";

type CatalogOverview = {
  readiness: {
    nativeCatalogMirrorReady: boolean;
    nativeCatalogMirror: {
      ready: boolean;
      drifted: boolean;
      reason: string | null;
      source: { products: number; plans: number; prices: number };
      mirror: {
        productCount: number;
        planCount: number;
        priceCount: number;
        retired: { products: number; plans: number; prices: number };
        syncedAt: string | null;
      } | null;
    };
  };
  metrics: {
    catalogProducts: number;
    catalogPlans: number;
    catalogPrices: number;
    liveBindings: number;
    effectiveEntitlements: number;
    provisioningPending: number;
    provisioningRunning: number;
    provisioningDead: number;
    provisioningDriftNeedsVerification: number;
  };
  mutationReadiness: {
    bindings: boolean;
    entitlements: boolean;
    entitlementReason: string;
  };
};

type BillingOverview = {
  processorConfigured: boolean;
  metrics: {
    customers: number;
    subscriptions: number;
    activeSubscriptions: number;
    invoices: number;
    openInvoices: number;
    amountOutstanding: number;
    failedWebhookEvents: number;
    pendingWebhookEvents: number;
    commercialOrganizations: number;
  };
  webhookHealth: Array<{
    status: string;
    count: number;
    latestAt: string | null;
  }>;
};

type UsageOverview = {
  summary: {
    billableEvents: number;
    pendingExport: number;
    failedExport: number;
    exported: number;
    billableQuantity: string;
  };
  coverage: {
    meteredOrgs: number;
    billingCustomers: number;
    missingCustomerMappings: number;
  };
  reconciliations: Array<{ id: string; status: string }>;
  worker: {
    ready: boolean;
    lastSeenAt: string | null;
  };
  processor: {
    ready: boolean;
    reason: string | null;
    meters: { required: number; present: number; missingNames: string[] };
    prices: { required: number; present: number; missingLookupKeys: string[] };
    checkedAt: string | null;
  };
};

type LoadState<T> = {
  data: T | null;
  error: string | null;
};

type AttentionItem = {
  key: string;
  title: string;
  detail: string;
  href: string;
  severity: "critical" | "warning" | "info";
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    const message =
      typeof body.error === "string"
        ? body.error
        : typeof body.message === "string"
          ? body.message
          : "Subsystem read failed";
    throw new Error(message);
  }
  return body as T;
}

function settledState<T>(result: PromiseSettledResult<T>): LoadState<T> {
  if (result.status === "fulfilled") return { data: result.value, error: null };
  return {
    data: null,
    error:
      result.reason instanceof Error
        ? result.reason.message
        : "Subsystem unavailable",
  };
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0) / 100);
}

function StatusBadge({ good, label }: { good: boolean; label: string }) {
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold " +
        (good ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800")
      }
    >
      {good ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
      {label}
    </span>
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
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold tracking-tight text-slate-950">
        {value}
      </p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
    </div>
  );
}

function SubsystemUnavailable({
  title,
  error,
}: {
  title: string;
  error: string | null;
}) {
  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5">
      <div className="flex items-start gap-3">
        <ShieldAlert size={18} className="mt-0.5 shrink-0 text-rose-700" />
        <div>
          <p className="text-sm font-semibold text-rose-950">
            {title} unavailable
          </p>
          <p className="mt-1 text-xs leading-5 text-rose-800">
            {error ?? "The canonical operator read did not return evidence."}
          </p>
        </div>
      </div>
    </div>
  );
}

export function CommerceOverviewWorkspace() {
  const [catalog, setCatalog] = useState<LoadState<CatalogOverview>>({
    data: null,
    error: null,
  });
  const [billing, setBilling] = useState<LoadState<BillingOverview>>({
    data: null,
    error: null,
  });
  const [usage, setUsage] = useState<LoadState<UsageOverview>>({
    data: null,
    error: null,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (background = false) => {
    if (background) setRefreshing(true);
    else setLoading(true);

    const [catalogResult, billingResult, usageResult] =
      await Promise.allSettled([
        fetchJson<CatalogOverview>("/api/platform/commerce/catalog"),
        fetchJson<BillingOverview>("/api/platform/commerce/billing?limit=1"),
        fetchJson<UsageOverview>("/api/platform/commerce/usage?window=24h"),
      ]);

    setCatalog(settledState(catalogResult));
    setBilling(settledState(billingResult));
    setUsage(settledState(usageResult));
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const attention = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];

    if (usage.data && !usage.data.processor.ready) {
      items.push({
        key: "usage-processor",
        title: "Stripe usage processor blocked",
        detail:
          usage.data.processor.reason ??
          "Canonical Stripe meter or price topology is incomplete.",
        href: "/platform/commerce/usage",
        severity: "critical",
      });
    }

    if (catalog.data?.metrics.provisioningDead) {
      items.push({
        key: "provisioning-dead",
        title:
          catalog.data.metrics.provisioningDead + " dead provisioning jobs",
        detail:
          "Historical failures require evidence-driven reconciliation; they are not an automatic revoke list.",
        href: "/platform/commerce/catalog",
        severity: "warning",
      });
    }

    if (catalog.data?.metrics.provisioningDriftNeedsVerification) {
      items.push({
        key: "provisioning-drift",
        title:
          catalog.data.metrics.provisioningDriftNeedsVerification +
          " provisioning drift rows need verification",
        detail:
          "Confirm current access and runtime linkage before remediation.",
        href: "/platform/commerce/catalog",
        severity: "warning",
      });
    }

    const billingAttention =
      (billing.data?.metrics.failedWebhookEvents ?? 0) +
      (billing.data?.metrics.pendingWebhookEvents ?? 0);
    if (billingAttention > 0) {
      items.push({
        key: "billing-webhooks",
        title: billingAttention + " billing webhook events need attention",
        detail:
          "Review signed Stripe ingestion evidence and reconciliation state.",
        href: "/platform/billing",
        severity: "critical",
      });
    }

    if (usage.data?.summary.failedExport) {
      items.push({
        key: "usage-export",
        title: usage.data.summary.failedExport + " usage exports failed",
        detail:
          "Retry only after processor readiness is restored and evidence is reviewed.",
        href: "/platform/commerce/usage",
        severity: "critical",
      });
    }

    if (usage.data?.coverage.missingCustomerMappings) {
      items.push({
        key: "usage-mapping",
        title:
          usage.data.coverage.missingCustomerMappings +
          " metered organizations lack Stripe customer mapping",
        detail:
          "Billing identity must be established before metered export can succeed.",
        href: "/platform/billing",
        severity: "warning",
      });
    }

    if (
      billing.data &&
      billing.data.metrics.subscriptions === 0 &&
      billing.data.metrics.invoices === 0 &&
      billing.data.webhookHealth.length === 0
    ) {
      items.push({
        key: "billing-no-evidence",
        title:
          "Billing ledger has no subscription, invoice, or webhook evidence yet",
        detail:
          "This is an evidence gap, not a healthy-zero signal. The customer mapping can exist before commercial activity arrives.",
        href: "/platform/billing",
        severity: "info",
      });
    }

    return items;
  }, [billing.data, catalog.data, usage.data]);

  if (loading) {
    return (
      <div className="grid min-h-72 place-items-center rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 text-sm font-medium text-slate-600">
          <Loader2 size={18} className="animate-spin text-blue-600" />
          Loading global commerce evidence…
        </div>
      </div>
    );
  }

  const systemsAvailable = [catalog.data, billing.data, usage.data].filter(
    Boolean,
  ).length;

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Global operator evidence
          </p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
            Commerce control plane
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
            This view reads the canonical platform-scoped Catalog, MigraPay, and
            Usage authorities. It is not tied to the active organization in the
            session.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={refreshing}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
          Refresh evidence
        </button>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Operator systems"
          value={systemsAvailable + "/3"}
          detail={
            systemsAvailable === 3
              ? "Catalog, billing, and usage reads available"
              : "One or more canonical reads are unavailable"
          }
        />
        <Metric
          label="Live Stripe bindings"
          value={String(catalog.data?.metrics.liveBindings ?? 0)}
          detail={
            catalog.data
              ? catalog.data.metrics.catalogPrices + " canonical catalog prices"
              : "Catalog evidence unavailable"
          }
        />
        <Metric
          label="Commercial accounts"
          value={String(billing.data?.metrics.commercialOrganizations ?? 0)}
          detail={
            billing.data
              ? billing.data.metrics.customers + " Stripe customer mappings"
              : "Billing evidence unavailable"
          }
        />
        <Metric
          label="Attention queue"
          value={attention.length.toLocaleString()}
          detail={
            attention.length > 0
              ? "Cross-system items requiring operator review"
              : "No current cross-system attention items"
          }
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-3">
        <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-50 text-violet-700">
              <Boxes size={18} />
            </span>
            {catalog.data ? (
              <StatusBadge
                good={catalog.data.readiness.nativeCatalogMirrorReady}
                label={
                  catalog.data.readiness.nativeCatalogMirrorReady
                    ? "Mirror aligned"
                    : "Mirror attention"
                }
              />
            ) : null}
          </div>
          <h3 className="mt-4 text-base font-semibold text-slate-950">
            Catalog & entitlements
          </h3>
          {catalog.data ? (
            <>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Metric
                  label="Catalog"
                  value={
                    catalog.data.metrics.catalogProducts +
                    " / " +
                    catalog.data.metrics.catalogPlans
                  }
                  detail="products / plans"
                />
                <Metric
                  label="Access"
                  value={catalog.data.metrics.effectiveEntitlements.toLocaleString()}
                  detail="effective entitlements"
                />
              </div>
              <p className="mt-4 text-xs leading-5 text-slate-600">
                Manual entitlement mutation is{" "}
                <strong>
                  {catalog.data.mutationReadiness.entitlements
                    ? "enabled"
                    : "disabled"}
                </strong>
                . {catalog.data.mutationReadiness.entitlementReason}
              </p>
            </>
          ) : (
            <div className="mt-4">
              <SubsystemUnavailable title="Catalog" error={catalog.error} />
            </div>
          )}
          <Link
            href="/platform/commerce/catalog"
            className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-blue-600"
          >
            Open catalog & entitlements <ArrowRight size={14} />
          </Link>
        </article>

        <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-700">
              <CreditCard size={18} />
            </span>
            {billing.data ? (
              <StatusBadge
                good={billing.data.processorConfigured}
                label={
                  billing.data.processorConfigured
                    ? "Stripe configured"
                    : "Processor blocked"
                }
              />
            ) : null}
          </div>
          <h3 className="mt-4 text-base font-semibold text-slate-950">
            MigraPay & billing
          </h3>
          {billing.data ? (
            <>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Metric
                  label="Subscriptions"
                  value={billing.data.metrics.activeSubscriptions.toLocaleString()}
                  detail={
                    billing.data.metrics.subscriptions + " total local rows"
                  }
                />
                <Metric
                  label="Open invoices"
                  value={billing.data.metrics.openInvoices.toLocaleString()}
                  detail={
                    formatMoney(billing.data.metrics.amountOutstanding) +
                    " outstanding"
                  }
                />
              </div>
              <p className="mt-4 text-xs leading-5 text-slate-600">
                {billing.data.metrics.subscriptions === 0 &&
                billing.data.metrics.invoices === 0 &&
                billing.data.webhookHealth.length === 0
                  ? "No subscription, invoice, or webhook evidence has arrived yet."
                  : "Commercial ledger evidence is available for operator reconciliation."}
              </p>
            </>
          ) : (
            <div className="mt-4">
              <SubsystemUnavailable title="Billing" error={billing.error} />
            </div>
          )}
          <Link
            href="/platform/billing"
            className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-blue-600"
          >
            Open MigraPay & billing <ArrowRight size={14} />
          </Link>
        </article>

        <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-50 text-cyan-700">
              <Waypoints size={18} />
            </span>
            {usage.data ? (
              <StatusBadge
                good={usage.data.worker.ready && usage.data.processor.ready}
                label={
                  usage.data.processor.ready
                    ? "Processor ready"
                    : usage.data.worker.ready
                      ? "Worker alive · processor blocked"
                      : "Worker unavailable"
                }
              />
            ) : null}
          </div>
          <h3 className="mt-4 text-base font-semibold text-slate-950">
            Usage & metering
          </h3>
          {usage.data ? (
            <>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Metric
                  label="Billable events"
                  value={usage.data.summary.billableEvents.toLocaleString()}
                  detail={usage.data.summary.exported + " exported"}
                />
                <Metric
                  label="Processor topology"
                  value={
                    usage.data.processor.meters.present +
                    "/" +
                    usage.data.processor.meters.required
                  }
                  detail={
                    usage.data.processor.prices.present +
                    "/" +
                    usage.data.processor.prices.required +
                    " metered prices"
                  }
                />
              </div>
              <p className="mt-4 text-xs leading-5 text-slate-600">
                {usage.data.processor.ready
                  ? "Stripe meter topology matches the canonical usage catalog."
                  : (usage.data.processor.reason ??
                    "Stripe usage processor topology is incomplete.")}
              </p>
            </>
          ) : (
            <div className="mt-4">
              <SubsystemUnavailable title="Usage" error={usage.error} />
            </div>
          )}
          <Link
            href="/platform/commerce/usage"
            className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-blue-600"
          >
            Open usage & metering <ArrowRight size={14} />
          </Link>
        </article>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-700">
              <Activity size={18} />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
                Operator attention
              </p>
              <h2 className="mt-0.5 text-lg font-semibold tracking-tight text-slate-950">
                Cross-system priority queue
              </h2>
            </div>
          </div>
        </div>

        {attention.length === 0 ? (
          <div className="p-6">
            <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <ShieldCheck size={18} className="mt-0.5 text-emerald-700" />
              <div>
                <p className="text-sm font-semibold text-emerald-950">
                  No detected commerce attention items
                </p>
                <p className="mt-1 text-xs leading-5 text-emerald-800">
                  All three canonical reads are available and no configured
                  thresholds currently require operator review.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {attention.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className="flex items-start justify-between gap-4 p-5 transition hover:bg-slate-50 sm:px-6"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className={
                      "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg " +
                      (item.severity === "critical"
                        ? "bg-rose-50 text-rose-700"
                        : item.severity === "warning"
                          ? "bg-amber-50 text-amber-700"
                          : "bg-blue-50 text-blue-700")
                    }
                  >
                    {item.severity === "critical" ? (
                      <ShieldAlert size={15} />
                    ) : item.severity === "warning" ? (
                      <AlertTriangle size={15} />
                    ) : (
                      <BadgeDollarSign size={15} />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-950">
                      {item.title}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      {item.detail}
                    </p>
                  </div>
                </div>
                <ArrowRight
                  size={15}
                  className="mt-2 shrink-0 text-slate-300"
                />
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
