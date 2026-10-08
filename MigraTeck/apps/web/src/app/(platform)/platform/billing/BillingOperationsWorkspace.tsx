"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeDollarSign,
  CheckCircle2,
  ChevronRight,
  CirclePause,
  CirclePlay,
  CreditCard,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";

type BillingOverview = {
  authority: {
    roles: string[];
    viaBootstrap: boolean;
    canManageBilling: boolean;
    managementPermission: string;
  };
  metrics: {
    customers: number;
    subscriptions: number;
    activeSubscriptions: number;
    invoices: number;
    openInvoices: number;
    amountOutstanding: number;
    failedWebhookEvents: number;
    pendingWebhookEvents: number;
    orgStates: number;
  };
  processorConfigured: boolean;
  organizations: Array<{
    id: string;
    name: string;
    slug: string;
    billingCustomerId: string | null;
    externalCustomerId: string | null;
    billingEmail: string | null;
    customerUpdatedAt: string | null;
    subscriptionCount: number;
    activeSubscriptionCount: number;
    invoiceCount: number;
    amountOutstanding: number | string;
    invoiceUpdatedAt: string | null;
    subscriptionUpdatedAt: string | null;
    standing: string | null;
    lastSyncedAt: string | null;
  }>;
  webhookHealth: Array<{
    status: string;
    count: number;
    latestAt: string | null;
  }>;
};

type LocalSubscription = {
  id: string;
  orgId: string;
  provider: string;
  externalSubscriptionId: string;
  externalCustomerId: string | null;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

type ProcessorSubscription = {
  id: string;
  customerId: string | null;
  status: string;
  stripeStatus: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  canceledAt: string | null;
  pauseCollection: {
    behavior: string;
    resumesAt: string | null;
  } | null;
  items: Array<{
    id: string;
    priceId: string | null;
    lookupKey: string | null;
    quantity: number | null;
  }>;
};

type BillingDetail = {
  canManageBilling: boolean;
  managementPermission: string;
  organization: {
    id: string;
    name: string;
    slug: string;
    authOrganizationId: string | null;
    isMigraHostingClient: boolean;
    createdAt: string;
    updatedAt: string;
  };
  customer: {
    id: string;
    orgId: string;
    provider: string;
    externalCustomerId: string;
    email: string | null;
    stripeAccountId: string | null;
    resellerPartnerId: string | null;
    updatedAt: string;
  } | null;
  subscriptions: LocalSubscription[];
  invoices: Array<{
    id: string;
    stripeInvoiceId: string;
    number: string | null;
    status: string;
    currency: string;
    subtotal: number;
    tax: number;
    total: number;
    amountPaid: number;
    amountRemaining: number;
    periodStart: string | null;
    periodEnd: string | null;
    hostedInvoiceUrl: string | null;
    invoicePdfUrl: string | null;
    finalizedAt: string | null;
    paidAt: string | null;
    updatedAt: string;
  }>;
  taxProfile: {
    legalName: string | null;
    billingEmail: string | null;
    country: string | null;
    stateRegion: string | null;
    city: string | null;
    postalCode: string | null;
    isBusiness: boolean;
    stripeTaxExempt: string | null;
  } | null;
  orgState: {
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    subscriptionStatus: string | null;
    latestInvoiceId: string | null;
    latestInvoiceStatus: string | null;
    standing: string;
    entitlementsVersion: number;
    lastStripeEventId: string | null;
    lastStripeEventType: string | null;
    lastSyncedAt: string | null;
    graceEndsAt: string | null;
    restrictedAt: string | null;
    suspendedAt: string | null;
  } | null;
  entitlements: Array<{
    id: string;
    product: string;
    status: string;
    startsAt: string | null;
    endsAt: string | null;
    notes: string | null;
    updatedAt: string;
  }>;
  eventProjections: Array<{
    id: string;
    projectionType: string;
    projectionRef: string | null;
    projectionStatus: string;
    eventId: string;
    eventType: string;
    eventStatus: string;
    reason: string | null;
    attempts: number;
    errorText: string | null;
    receivedAt: string;
    processedAt: string | null;
    projectedAt: string;
  }>;
  processor: {
    configured: boolean;
    completeness?: {
      subscriptions: boolean;
      invoices: boolean;
      paymentMethods: boolean;
    };
    customer: {
      id: string;
      email: string | null;
      name: string | null;
      balance: number;
      delinquent: boolean | null;
      defaultPaymentMethodId: string | null;
    } | null;
    subscriptions: ProcessorSubscription[];
    invoices: Array<{
      id: string;
      number: string | null;
      status: string;
      currency: string;
      total: number;
      amountPaid: number;
      amountRemaining: number;
      hostedInvoiceUrl: string | null;
    }>;
    paymentMethods: Array<{
      id: string;
      type: string;
      brand: string | null;
      last4: string | null;
      expMonth: number | null;
      expYear: number | null;
    }>;
    error: string | null;
  };
  drift: {
    checked: boolean;
    complete: boolean;
    healthy: boolean | null;
    emailMismatch: boolean;
    missingLocalSubscriptions: string[];
    orphanedLocalSubscriptions: string[];
    subscriptionStatusMismatches: Array<{
      id: string;
      local: string;
      processor: string;
    }>;
    missingLocalInvoices: string[];
    orphanedLocalInvoices: string[];
    invoiceStatusMismatches: Array<{
      id: string;
      local: string;
      processor: string;
    }>;
  };
};

type SubscriptionAction =
  | "pause_collection"
  | "resume_collection"
  | "cancel_at_period_end"
  | "cancel_immediate";

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function formatMoney(value: number | string, currency = "usd") {
  const numeric = Number(value || 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(numeric / 100);
}

function statusClass(status: string | null | undefined) {
  const value = (status ?? "").toUpperCase();
  if (["ACTIVE", "PAID", "PROCESSED", "GOOD", "TRIALING"].includes(value)) {
    return "bg-emerald-50 text-emerald-700";
  }
  if (["PAUSED", "PAST_DUE", "OPEN", "RECEIVED", "QUEUED", "PROCESSING"].includes(value)) {
    return "bg-amber-50 text-amber-700";
  }
  if (["FAILED", "UNPAID", "CANCELED", "INCOMPLETE_EXPIRED", "SUSPENDED"].includes(value)) {
    return "bg-rose-50 text-rose-700";
  }
  return "bg-slate-100 text-slate-600";
}

function driftCount(drift: BillingDetail["drift"]) {
  return (
    (drift.emailMismatch ? 1 : 0) +
    drift.missingLocalSubscriptions.length +
    drift.orphanedLocalSubscriptions.length +
    drift.subscriptionStatusMismatches.length +
    drift.missingLocalInvoices.length +
    drift.orphanedLocalInvoices.length +
    drift.invoiceStatusMismatches.length
  );
}

export function BillingOperationsWorkspace() {
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [query, setQuery] = useState("");
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BillingDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reconcileReason, setReconcileReason] = useState("");
  const [reconciling, setReconciling] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionReason, setActionReason] = useState("");
  const [actionTarget, setActionTarget] = useState<{
    subscription: LocalSubscription;
    action: SubscriptionAction;
  } | null>(null);
  const [customerInitMode, setCustomerInitMode] = useState<
    "create" | "link_existing"
  >("create");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerExternalId, setCustomerExternalId] = useState("");
  const [customerReason, setCustomerReason] = useState("");
  const [customerOperationId, setCustomerOperationId] = useState<string | null>(
    null,
  );
  const [customerInitializing, setCustomerInitializing] = useState(false);

  const loadOverview = useCallback(async (search = "", background = false) => {
    if (!background) setOverviewLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "60" });
      if (search.trim()) params.set("q", search.trim());
      const response = await fetch(
        "/api/platform/commerce/billing?" + params.toString(),
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to load MigraPay operations");
      setOverview(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load MigraPay operations");
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (orgId: string) => {
    setDetailLoading(true);
    setError(null);
    try {
      const response = await fetch(
        "/api/platform/commerce/billing/organizations/" + encodeURIComponent(orgId),
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to load billing evidence");
      setDetail(body);
    } catch (err) {
      setDetail(null);
      setError(err instanceof Error ? err.message : "Unable to load billing evidence");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview("");
  }, [loadOverview]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadOverview(query, true), 300);
    return () => window.clearTimeout(timer);
  }, [query, loadOverview]);

  const selectedSummary = useMemo(
    () => overview?.organizations.find((org) => org.id === selectedOrgId) ?? null,
    [overview, selectedOrgId],
  );

  const processorSubscriptions = useMemo(
    () => new Map(detail?.processor.subscriptions.map((item) => [item.id, item]) ?? []),
    [detail],
  );

  async function selectOrganization(orgId: string) {
    setSelectedOrgId(orgId);
    setNotice(null);
    setReconcileReason("");
    setActionTarget(null);
    setActionReason("");
    setCustomerInitMode("create");
    setCustomerEmail("");
    setCustomerExternalId("");
    setCustomerReason("");
    setCustomerOperationId(null);
    await loadDetail(orgId);
  }

  async function initializeCustomer() {
    if (!detail || !detail.canManageBilling || detail.customer) return;
    if (customerReason.trim().length < 3) return;
    if (customerInitMode === "create" && !customerEmail.trim()) return;
    if (customerInitMode === "link_existing" && !customerExternalId.trim()) return;

    const operationId = customerOperationId ?? crypto.randomUUID();
    if (!customerOperationId) setCustomerOperationId(operationId);

    setCustomerInitializing(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        "/api/platform/commerce/billing/organizations/" +
          encodeURIComponent(detail.organization.id) +
          "/customer",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operationId,
            mode: customerInitMode,
            reason: customerReason.trim(),
            ...(customerInitMode === "create"
              ? { billingEmail: customerEmail.trim() }
              : { externalCustomerId: customerExternalId.trim() }),
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Unable to initialize MigraPay customer");
      }

      if (body.detail) {
        setDetail(body.detail as BillingDetail);
      } else {
        await loadDetail(detail.organization.id);
      }
      setCustomerEmail("");
      setCustomerExternalId("");
      setCustomerReason("");
      setCustomerOperationId(null);
      setNotice(
        customerInitMode === "create"
          ? "Stripe customer created, mapped to this organization, and audited."
          : "Existing Stripe customer verified, linked to this organization, and audited.",
      );
      await loadOverview(query, true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to initialize MigraPay customer",
      );
    } finally {
      setCustomerInitializing(false);
    }
  }

  async function reconcile() {
    if (!detail || reconcileReason.trim().length < 3) return;
    setReconciling(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        "/api/platform/commerce/billing/organizations/" +
          encodeURIComponent(detail.organization.id) +
          "/reconcile",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operationId: crypto.randomUUID(),
            reason: reconcileReason.trim(),
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Billing reconciliation failed");
      setDetail(body);
      setReconcileReason("");
      setNotice("Stripe evidence reconciled into the MigraPay ledger and audited.");
      await loadOverview(query, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Billing reconciliation failed");
    } finally {
      setReconciling(false);
    }
  }

  function openAction(subscription: LocalSubscription, action: SubscriptionAction) {
    setActionTarget({ subscription, action });
    setActionReason("");
    setNotice(null);
  }

  async function executeAction() {
    if (!detail || !actionTarget || actionReason.trim().length < 3) return;
    const { subscription, action } = actionTarget;

    const destructive =
      action === "cancel_immediate"
        ? "Immediately cancel this subscription and allow Stripe to prorate it now?"
        : action === "cancel_at_period_end"
          ? "Schedule this subscription to cancel at the end of its current period?"
          : action === "pause_collection"
            ? "Pause Stripe collection for this subscription?"
            : "Resume Stripe collection for this subscription?";

    if (!window.confirm(destructive)) return;
    if (
      action === "cancel_immediate" &&
      !window.confirm(
        "This is the final confirmation for immediate cancellation. Continue?",
      )
    ) {
      return;
    }

    setActionBusy(subscription.id + ":" + action);
    setError(null);
    try {
      const response = await fetch(
        "/api/platform/commerce/billing/organizations/" +
          encodeURIComponent(detail.organization.id) +
          "/subscriptions/" +
          encodeURIComponent(subscription.id) +
          "/action",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operationId: crypto.randomUUID(),
            action,
            reason: actionReason.trim(),
            expectedUpdatedAt: subscription.updatedAt,
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Subscription action failed");
      setNotice("Subscription action completed in Stripe, synchronized locally, and audited.");
      setActionTarget(null);
      setActionReason("");
      await Promise.all([
        loadDetail(detail.organization.id),
        loadOverview(query, true),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Subscription action failed");
    } finally {
      setActionBusy(null);
    }
  }

  if (overviewLoading && !overview) {
    return (
      <div className="grid min-h-72 place-items-center rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 text-sm font-medium text-slate-600">
          <Loader2 size={18} className="animate-spin text-blue-600" />
          Loading MigraPay operations…
        </div>
      </div>
    );
  }

  if (!overview) {
    return (
      <section className="rounded-3xl border border-rose-200 bg-rose-50 p-6">
        <h2 className="font-semibold text-rose-950">MigraPay operator workspace unavailable</h2>
        <p className="mt-2 text-sm leading-6 text-rose-800">
          {error ?? "Platform commerce authority is required."}
        </p>
        <button
          onClick={() => void loadOverview(query)}
          className="mt-4 inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-800"
        >
          <RefreshCw size={15} /> Retry
        </button>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {overview.authority.viaBootstrap ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This session is using MigraAuth bootstrap authority. Move the operator to a persistent platform role before removing the bootstrap path.
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          {notice}
        </div>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Billing customers"
          value={overview.metrics.customers.toLocaleString()}
          detail={overview.processorConfigured ? "Stripe processor configured" : "Stripe processor unavailable"}
        />
        <MetricCard
          label="Active subscriptions"
          value={overview.metrics.activeSubscriptions.toLocaleString()}
          detail={overview.metrics.subscriptions + " subscriptions in local ledger"}
        />
        <MetricCard
          label="Open invoices"
          value={overview.metrics.openInvoices.toLocaleString()}
          detail={formatMoney(overview.metrics.amountOutstanding) + " outstanding"}
        />
        <MetricCard
          label="Webhook attention"
          value={(overview.metrics.failedWebhookEvents + overview.metrics.pendingWebhookEvents).toLocaleString()}
          detail={overview.metrics.failedWebhookEvents + " failed · " + overview.metrics.pendingWebhookEvents + " pending"}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.72fr_1.28fr]">
        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
              Organizations
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
              Commercial accounts
            </h2>
            <div className="relative mt-4">
              <Search
                size={16}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search org, slug, email, Stripe customer…"
                className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm text-slate-800 outline-none focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10"
              />
            </div>
          </div>

          <div className="max-h-[46rem] divide-y divide-slate-100 overflow-y-auto">
            {overview.organizations.map((org) => (
              <button
                key={org.id}
                onClick={() => void selectOrganization(org.id)}
                className={
                  "w-full p-4 text-left transition hover:bg-slate-50 " +
                  (selectedOrgId === org.id ? "bg-blue-50/70" : "")
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{org.name}</p>
                    <code className="mt-1 block truncate text-[10px] text-slate-400">{org.slug}</code>
                  </div>
                  <ChevronRight size={15} className="mt-1 shrink-0 text-slate-300" />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
                  <span>{org.activeSubscriptionCount} active</span>
                  <span>{org.invoiceCount} invoices</span>
                  <span>{formatMoney(org.amountOutstanding)} due</span>
                </div>
                {org.externalCustomerId ? (
                  <code className="mt-2 block truncate text-[10px] font-medium text-blue-600">
                    {org.externalCustomerId}
                  </code>
                ) : (
                  <p className="mt-2 text-[10px] font-medium text-slate-400">No Stripe mapping</p>
                )}
              </button>
            ))}
            {overview.organizations.length === 0 ? (
              <p className="p-6 text-sm text-slate-500">No organizations match this search.</p>
            ) : null}
          </div>
        </div>

        <div className="min-w-0 rounded-3xl border border-slate-200 bg-white shadow-sm">
          {detailLoading ? (
            <div className="grid min-h-[34rem] place-items-center">
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 size={17} className="animate-spin" /> Loading processor evidence…
              </div>
            </div>
          ) : detail ? (
            <div className="space-y-6 p-5 sm:p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Selected commercial account
                  </p>
                  <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
                    {detail.organization.name}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">{detail.organization.slug}</p>
                  {detail.customer ? (
                    <code className="mt-2 block text-xs font-semibold text-blue-600">
                      {detail.customer.externalCustomerId}
                    </code>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusPill value={detail.orgState?.standing ?? "NO_STATE"} />
                  {detail.drift.checked ? (
                    detail.drift.healthy ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                        <CheckCircle2 size={13} /> Ledger aligned
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700">
                        <AlertTriangle size={13} /> {driftCount(detail.drift)} drift signals
                      </span>
                    )
                  ) : (
                    <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">
                      Processor not checked
                    </span>
                  )}
                </div>
              </div>

              {!detail.customer ? (
                <section className="rounded-2xl border border-blue-200 bg-[linear-gradient(135deg,#f8fbff,#ffffff)] p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-600">
                        Customer initialization
                      </p>
                      <h3 className="mt-1 text-base font-semibold text-slate-950">
                        Initialize MigraPay for this organization
                      </h3>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                        Create a new Stripe customer with MigraTeck organization metadata, or verify and link an existing Stripe customer. This establishes the commercial identity required before reconciliation, payment methods, or subscription operations.
                      </p>
                    </div>
                    <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700">
                      No Stripe mapping
                    </span>
                  </div>

                  {detail.canManageBilling ? (
                    <div className="mt-5 space-y-4">
                      <div className="grid grid-cols-2 rounded-xl border border-slate-200 bg-slate-100 p-1 sm:max-w-md">
                        <button
                          type="button"
                          onClick={() => {
                            setCustomerInitMode("create");
                            setCustomerOperationId(null);
                          }}
                          className={
                            "rounded-lg px-3 py-2 text-xs font-semibold transition " +
                            (customerInitMode === "create"
                              ? "bg-white text-slate-950 shadow-sm"
                              : "text-slate-500 hover:text-slate-800")
                          }
                        >
                          Create Stripe customer
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCustomerInitMode("link_existing");
                            setCustomerOperationId(null);
                          }}
                          className={
                            "rounded-lg px-3 py-2 text-xs font-semibold transition " +
                            (customerInitMode === "link_existing"
                              ? "bg-white text-slate-950 shadow-sm"
                              : "text-slate-500 hover:text-slate-800")
                          }
                        >
                          Link existing customer
                        </button>
                      </div>

                      <div className="grid gap-3 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
                        <label className="text-sm font-semibold text-slate-800">
                          {customerInitMode === "create"
                            ? "Billing email"
                            : "Stripe customer ID"}
                          <input
                            value={
                              customerInitMode === "create"
                                ? customerEmail
                                : customerExternalId
                            }
                            onChange={(event) =>
                              customerInitMode === "create"
                                ? setCustomerEmail(event.target.value)
                                : setCustomerExternalId(event.target.value)
                            }
                            type={
                              customerInitMode === "create" ? "email" : "text"
                            }
                            placeholder={
                              customerInitMode === "create"
                                ? "billing@example.com"
                                : "cus_..."
                            }
                            className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                          />
                        </label>

                        <label className="text-sm font-semibold text-slate-800">
                          Operator reason
                          <input
                            value={customerReason}
                            onChange={(event) =>
                              setCustomerReason(event.target.value)
                            }
                            maxLength={500}
                            placeholder="Why is this billing identity being created or linked?"
                            className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                          />
                        </label>

                        <button
                          type="button"
                          onClick={() => void initializeCustomer()}
                          disabled={
                            customerInitializing ||
                            customerReason.trim().length < 3 ||
                            (customerInitMode === "create"
                              ? !customerEmail.trim()
                              : !customerExternalId.trim())
                          }
                          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          {customerInitializing ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <CreditCard size={14} />
                          )}
                          {customerInitializing
                            ? "Initializing…"
                            : customerInitMode === "create"
                              ? "Create customer"
                              : "Verify & link"}
                        </button>
                      </div>

                      <p className="text-xs leading-5 text-slate-500">
                        Existing links are ownership-checked locally and against Stripe metadata. Create operations use Stripe idempotency keyed to the operator operation UUID.
                      </p>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs leading-5 text-slate-600">
                      Read-only. {detail.managementPermission} is required to initialize a billing customer.
                    </div>
                  )}
                </section>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <MiniStat label="Local subscriptions" value={String(detail.subscriptions.length)} />
                    <MiniStat label="Local invoices" value={String(detail.invoices.length)} />
                    <MiniStat label="Processor subscriptions" value={String(detail.processor.subscriptions.length)} />
                    <MiniStat label="Payment methods" value={String(detail.processor.paymentMethods.length)} />
                  </div>

                  {detail.processor.error ? (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                      <strong>Stripe evidence unavailable:</strong> {detail.processor.error}
                    </div>
                  ) : null}

                  <DriftPanel drift={detail.drift} />

                  <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-600">
                          Reconciliation
                        </p>
                        <h3 className="mt-1 text-sm font-semibold text-slate-950">
                          Refresh local ledger from Stripe
                        </h3>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          Reads complete subscription/invoice history within the safety cap, upserts the local ledger transactionally, and writes an operator audit record.
                        </p>
                      </div>
                      {detail.canManageBilling ? (
                        <div className="w-full max-w-md">
                          <input
                            value={reconcileReason}
                            onChange={(event) => setReconcileReason(event.target.value)}
                            placeholder="Reason for reconciliation…"
                            maxLength={500}
                            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-violet-400"
                          />
                          <button
                            onClick={() => void reconcile()}
                            disabled={reconciling || reconcileReason.trim().length < 3}
                            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-45"
                          >
                            {reconciling ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                            {reconciling ? "Reconciling…" : "Reconcile ledger"}
                          </button>
                        </div>
                      ) : (
                        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                          Read-only. {detail.managementPermission} is required to mutate billing state.
                        </div>
                      )}
                    </div>
                  </section>

                  <section>
                    <SectionTitle
                      eyebrow="Subscription control"
                      title="Subscriptions"
                      description="Every action re-reads Stripe ownership before mutation and uses an idempotency key."
                    />
                    {detail.subscriptions.length === 0 ? (
                      <EmptyLine text="No local subscriptions are recorded for this organization." />
                    ) : (
                      <div className="mt-3 space-y-3">
                        {detail.subscriptions.map((subscription) => {
                          const remote = processorSubscriptions.get(subscription.externalSubscriptionId);
                          return (
                            <article
                              key={subscription.id}
                              className="rounded-2xl border border-slate-200 bg-white p-4"
                            >
                              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <StatusPill value={subscription.status} />
                                    {remote && remote.status !== subscription.status ? (
                                      <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">
                                        Stripe: {remote.status}
                                      </span>
                                    ) : null}
                                    {subscription.cancelAtPeriodEnd ? (
                                      <span className="rounded-full bg-rose-50 px-2 py-1 text-[10px] font-semibold text-rose-700">
                                        Cancels at period end
                                      </span>
                                    ) : null}
                                  </div>
                                  <code className="mt-2 block break-all text-xs font-semibold text-slate-800">
                                    {subscription.externalSubscriptionId}
                                  </code>
                                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                                    <span>Period {formatDate(subscription.currentPeriodStart)} → {formatDate(subscription.currentPeriodEnd)}</span>
                                    <span>Local update {formatDate(subscription.updatedAt)}</span>
                                  </div>
                                  {remote?.items.length ? (
                                    <div className="mt-3 flex flex-wrap gap-1.5">
                                      {remote.items.map((item) => (
                                        <span key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-600">
                                          {item.lookupKey ?? item.priceId ?? "Unknown price"} × {item.quantity ?? 1}
                                        </span>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>

                                {detail.canManageBilling && subscription.status !== "CANCELED" ? (
                                  <div className="flex shrink-0 flex-wrap gap-2">
                                    {remote?.pauseCollection ? (
                                      <ActionButton
                                        icon={<CirclePlay size={13} />}
                                        label="Resume"
                                        onClick={() => openAction(subscription, "resume_collection")}
                                      />
                                    ) : (
                                      <ActionButton
                                        icon={<CirclePause size={13} />}
                                        label="Pause collection"
                                        onClick={() => openAction(subscription, "pause_collection")}
                                      />
                                    )}
                                    {!subscription.cancelAtPeriodEnd ? (
                                      <ActionButton
                                        label="Cancel at period end"
                                        onClick={() => openAction(subscription, "cancel_at_period_end")}
                                      />
                                    ) : null}
                                    <ActionButton
                                      danger
                                      label="Cancel now"
                                      onClick={() => openAction(subscription, "cancel_immediate")}
                                    />
                                  </div>
                                ) : null}
                              </div>

                              {actionTarget?.subscription.id === subscription.id ? (
                                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
                                  <p className="text-xs font-semibold text-amber-900">
                                    {actionTarget.action.replace(/_/g, " ")}
                                  </p>
                                  <textarea
                                    value={actionReason}
                                    onChange={(event) => setActionReason(event.target.value)}
                                    rows={2}
                                    maxLength={500}
                                    placeholder="Required operator reason…"
                                    className="mt-2 w-full resize-y rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm outline-none"
                                  />
                                  <div className="mt-2 flex gap-2">
                                    <button
                                      onClick={() => void executeAction()}
                                      disabled={
                                        actionReason.trim().length < 3 ||
                                        actionBusy === subscription.id + ":" + actionTarget.action
                                      }
                                      className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-45"
                                    >
                                      {actionBusy ? <Loader2 size={12} className="animate-spin" /> : null}
                                      Confirm action
                                    </button>
                                    <button
                                      onClick={() => {
                                        setActionTarget(null);
                                        setActionReason("");
                                      }}
                                      className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-semibold text-amber-800"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : null}
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </section>

                  <div className="grid gap-5 xl:grid-cols-2">
                    <ProcessorPanel detail={detail} />
                    <OrgStatePanel detail={detail} />
                  </div>

                  <section>
                    <SectionTitle
                      eyebrow="Receivables"
                      title="Invoices"
                      description="Local invoice mirror with safe links back to Stripe-hosted customer evidence."
                    />
                    {detail.invoices.length === 0 ? (
                      <EmptyLine text="No invoices are recorded for this organization." />
                    ) : (
                      <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200">
                        <div className="max-h-[30rem] divide-y divide-slate-100 overflow-y-auto">
                          {detail.invoices.map((invoice) => (
                            <article key={invoice.id} className="p-4">
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <StatusPill value={invoice.status} />
                                    <span className="text-sm font-semibold text-slate-900">
                                      {invoice.number ?? invoice.stripeInvoiceId}
                                    </span>
                                  </div>
                                  <code className="mt-1 block text-[10px] text-slate-400">
                                    {invoice.stripeInvoiceId}
                                  </code>
                                  <p className="mt-2 text-xs text-slate-500">
                                    {formatDate(invoice.periodStart)} → {formatDate(invoice.periodEnd)}
                                  </p>
                                </div>
                                <div className="text-left sm:text-right">
                                  <p className="text-sm font-semibold text-slate-950">
                                    {formatMoney(invoice.total, invoice.currency)}
                                  </p>
                                  <p className="mt-1 text-xs text-slate-500">
                                    {formatMoney(invoice.amountRemaining, invoice.currency)} remaining
                                  </p>
                                  <div className="mt-2 flex gap-2 sm:justify-end">
                                    {invoice.hostedInvoiceUrl ? (
                                      <a
                                        href={invoice.hostedInvoiceUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-xs font-semibold text-blue-600"
                                      >
                                        Hosted invoice
                                      </a>
                                    ) : null}
                                    {invoice.invoicePdfUrl ? (
                                      <a
                                        href={invoice.invoicePdfUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-xs font-semibold text-blue-600"
                                      >
                                        PDF
                                      </a>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            </article>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>

                  <div className="grid gap-5 xl:grid-cols-2">
                    <EvidencePanel
                      title="Effective entitlements"
                      empty="No product entitlements are recorded."
                      rows={detail.entitlements.map((item) => ({
                        key: item.id,
                        title: item.product,
                        status: item.status,
                        detail: item.endsAt ? "Ends " + formatDate(item.endsAt) : "No expiry",
                      }))}
                    />
                    <EvidencePanel
                      title="Billing event projections"
                      empty="No billing webhook projections are recorded."
                      rows={detail.eventProjections.map((item) => ({
                        key: item.id,
                        title: item.eventType,
                        status: item.eventStatus,
                        detail:
                          item.projectionType +
                          (item.projectionRef ? " · " + item.projectionRef : "") +
                          " · " +
                          formatDate(item.projectedAt),
                      }))}
                    />
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="grid min-h-[34rem] place-items-center p-8 text-center">
              <div>
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500">
                  <BadgeDollarSign size={21} />
                </span>
                <h3 className="mt-4 text-sm font-semibold text-slate-900">
                  Select a commercial account
                </h3>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">
                  Stripe comparison, subscriptions, invoices, payment methods, drift, and operator controls will load here.
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 p-5 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Stripe webhook pipeline
          </p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
            Billing event health
          </h2>
        </div>
        {overview.webhookHealth.length === 0 ? (
          <EmptyLine text="No billing webhook events have been recorded yet." />
        ) : (
          <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-6 xl:grid-cols-4">
            {overview.webhookHealth.map((row) => (
              <div key={row.status} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <StatusPill value={row.status} />
                <p className="mt-3 text-2xl font-semibold text-slate-950">{row.count}</p>
                <p className="mt-1 text-xs text-slate-500">Latest {formatDate(row.latestAt)}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
    </article>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function StatusPill({ value }: { value: string }) {
  return (
    <span
      className={
        "inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] " +
        statusClass(value)
      }
    >
      {value.replace(/_/g, " ")}
    </span>
  );
}

function SectionTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{eyebrow}</p>
      <h3 className="mt-1 text-base font-semibold text-slate-950">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
      {text}
    </div>
  );
}

function ActionButton({
  label,
  icon,
  danger = false,
  onClick,
}: {
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition " +
        (danger
          ? "border-rose-200 text-rose-700 hover:bg-rose-50"
          : "border-slate-200 text-slate-700 hover:bg-slate-50")
      }
    >
      {icon}
      {label}
    </button>
  );
}

function DriftPanel({ drift }: { drift: BillingDetail["drift"] }) {
  if (!drift.checked) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-semibold text-slate-900">Drift not checked</p>
        <p className="mt-1 text-xs text-slate-500">Live processor evidence is unavailable.</p>
      </div>
    );
  }

  const count = driftCount(drift);
  return (
    <div
      className={
        "rounded-2xl border p-4 " +
        (drift.healthy
          ? "border-emerald-200 bg-emerald-50"
          : "border-amber-200 bg-amber-50")
      }
    >
      <div className="flex items-center gap-2">
        {drift.healthy ? (
          <ShieldCheck size={16} className="text-emerald-700" />
        ) : (
          <ShieldAlert size={16} className="text-amber-700" />
        )}
        <h3 className="text-sm font-semibold text-slate-900">
          {drift.healthy ? "Ledger and Stripe are aligned" : count + " drift signals detected"}
        </h3>
      </div>
      {!drift.complete ? (
        <p className="mt-2 text-xs font-medium text-amber-800">
          Processor history exceeded the comparison window; orphan checks are intentionally suppressed.
        </p>
      ) : null}
      {!drift.healthy && count > 0 ? (
        <div className="mt-3 grid gap-2 text-xs text-slate-700 sm:grid-cols-2">
          {drift.emailMismatch ? <span>• Billing email differs</span> : null}
          {drift.missingLocalSubscriptions.length ? (
            <span>• {drift.missingLocalSubscriptions.length} Stripe subscriptions missing locally</span>
          ) : null}
          {drift.orphanedLocalSubscriptions.length ? (
            <span>• {drift.orphanedLocalSubscriptions.length} local subscriptions absent in Stripe</span>
          ) : null}
          {drift.subscriptionStatusMismatches.length ? (
            <span>• {drift.subscriptionStatusMismatches.length} subscription status mismatches</span>
          ) : null}
          {drift.missingLocalInvoices.length ? (
            <span>• {drift.missingLocalInvoices.length} Stripe invoices missing locally</span>
          ) : null}
          {drift.orphanedLocalInvoices.length ? (
            <span>• {drift.orphanedLocalInvoices.length} local invoices absent in Stripe</span>
          ) : null}
          {drift.invoiceStatusMismatches.length ? (
            <span>• {drift.invoiceStatusMismatches.length} invoice status mismatches</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ProcessorPanel({ detail }: { detail: BillingDetail }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-600">Stripe customer</p>
      {detail.processor.customer ? (
        <>
          <p className="mt-2 text-sm font-semibold text-slate-950">
            {detail.processor.customer.name ?? detail.processor.customer.email ?? detail.processor.customer.id}
          </p>
          <code className="mt-1 block text-[10px] text-slate-500">{detail.processor.customer.id}</code>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <MiniStat
              label="Balance"
              value={formatMoney(detail.processor.customer.balance)}
            />
            <MiniStat
              label="Delinquent"
              value={detail.processor.customer.delinquent ? "Yes" : "No"}
            />
          </div>
          <div className="mt-3 space-y-2">
            {detail.processor.paymentMethods.map((method) => (
              <div key={method.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
                <CreditCard size={16} className="text-slate-400" />
                <div>
                  <p className="text-xs font-semibold text-slate-800">
                    {(method.brand ?? method.type).toUpperCase()} •••• {method.last4 ?? "—"}
                  </p>
                  <p className="mt-0.5 text-[10px] text-slate-400">
                    Expires {method.expMonth ?? "—"}/{method.expYear ?? "—"}
                  </p>
                </div>
              </div>
            ))}
            {detail.processor.paymentMethods.length === 0 ? (
              <p className="text-xs text-slate-500">No card payment methods returned by Stripe.</p>
            ) : null}
          </div>
        </>
      ) : (
        <p className="mt-2 text-xs leading-5 text-slate-500">No processor customer evidence loaded.</p>
      )}
    </section>
  );
}

function OrgStatePanel({ detail }: { detail: BillingDetail }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-600">Commercial state</p>
      {detail.orgState ? (
        <div className="mt-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-slate-500">Standing</span>
            <StatusPill value={detail.orgState.standing} />
          </div>
          <KeyValue label="Subscription" value={detail.orgState.subscriptionStatus ?? "—"} />
          <KeyValue label="Latest invoice" value={detail.orgState.latestInvoiceStatus ?? "—"} />
          <KeyValue label="Entitlement version" value={String(detail.orgState.entitlementsVersion)} />
          <KeyValue label="Last Stripe event" value={detail.orgState.lastStripeEventType ?? "—"} />
          <KeyValue label="Last synced" value={formatDate(detail.orgState.lastSyncedAt)} />
        </div>
      ) : (
        <p className="mt-2 text-xs leading-5 text-slate-500">
          No BillingOrgState row exists yet. Reconciliation can create the first synchronized state.
        </p>
      )}

      {detail.taxProfile ? (
        <div className="mt-4 border-t border-slate-200 pt-4">
          <p className="text-xs font-semibold text-slate-800">Tax profile</p>
          <p className="mt-1 text-xs text-slate-500">
            {detail.taxProfile.legalName ?? "No legal name"} · {detail.taxProfile.country ?? "No country"}
          </p>
          <p className="mt-1 text-[10px] text-slate-400">
            {detail.taxProfile.stripeTaxExempt ?? "Tax exemption not set"}
          </p>
        </div>
      ) : null}
    </section>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <span className="text-slate-500">{label}</span>
      <span className="max-w-[65%] break-words text-right font-semibold text-slate-800">{value}</span>
    </div>
  );
}

function EvidencePanel({
  title,
  empty,
  rows,
}: {
  title: string;
  empty: string;
  rows: Array<{ key: string; title: string; status: string; detail: string }>;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      </div>
      {rows.length === 0 ? (
        <p className="p-4 text-xs leading-5 text-slate-500">{empty}</p>
      ) : (
        <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
          {rows.map((row) => (
            <div key={row.key} className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-900">{row.title}</span>
                <StatusPill value={row.status} />
              </div>
              <p className="mt-2 text-[10px] leading-5 text-slate-500">{row.detail}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
