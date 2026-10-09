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
  Activity,
  AlertTriangle,
  BadgeDollarSign,
  CheckCircle2,
  CircleDashed,
  Database,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Webhook,
  XCircle,
} from "lucide-react";

type ReadinessIssue = {
  code: string;
  severity: "critical" | "warning";
  title: string;
  detail: string;
};

type ReadinessOrganization = {
  orgId: string;
  orgName: string;
  orgSlug: string;
  customerMappedAt: string | null;
  lastSyncedAt: string | null;
  subscriptionCount: number;
  invoiceCount: number;
  syncState: "synced" | "never_synced";
};

type Payload = {
  checkedAt: string;
  overall: "ready" | "degraded" | "blocked";
  summary: {
    critical: number;
    warning: number;
  };
  configuration: {
    billingEnabled: boolean;
    processorSecretConfigured: boolean;
    webhookSecretConfigured: boolean;
    endpointIdConfigured: boolean;
    expectedUrl: string;
    configuredUrl: string;
  };
  endpoint: {
    checked: boolean;
    exists: boolean;
    enabled: boolean;
    matchesExpectedUrl: boolean;
    matchesExpectedApiVersion: boolean;
    status: string | null;
    apiVersion: string | null;
    createdAt: string | null;
    enabledEventCount: number;
    requiredEventCount: number;
    missingEvents: string[];
  };
  processor: {
    checked: boolean;
    recentEventSampleCount: number;
    sampleComplete: boolean;
    latestEventAt: string | null;
    relevantEventsSinceEndpointCreation: number;
    locallyObservedRelevantEvents: number;
    missingLocalDeliveries: number;
    deliveryState:
      | "unverified"
      | "awaiting_first_event"
      | "observed"
      | "delivery_gap";
  };
  ledger: {
    customerCount: number;
    orgStateCount: number;
    subscriptionCount: number;
    invoiceCount: number;
    webhookEventCount: number;
    projectionCount: number;
    processedWebhookCount: number;
    ignoredWebhookCount: number;
    failedWebhookCount: number;
    stalledWebhookCount: number;
    unmappedIgnoredCount: number;
    latestWebhookAt: string | null;
    latestSyncAt: string | null;
    neverSyncedMappedOrganizations: number;
  };
  organizations: ReadinessOrganization[];
  issues: ReadinessIssue[];
};

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "No evidence";
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] " +
        (ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700")
      }
    >
      {ok ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
      {label}
    </span>
  );
}

export function BillingReadinessWorkspace() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/platform/commerce/billing-readiness", {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Unable to load billing readiness");
      }
      setData(body as Payload);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load billing readiness",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const reconciledMappedOrganizations = Math.max(
    0,
    (data?.ledger.customerCount ?? 0) -
      (data?.ledger.neverSyncedMappedOrganizations ?? 0),
  );

  const coveragePercent = useMemo(() => {
    const required = data?.endpoint.requiredEventCount ?? 0;
    if (!required) return 0;
    return Math.round(
      ((data?.endpoint.enabledEventCount ?? 0) / required) * 100,
    );
  }, [data]);

  if (loading && !data) {
    return (
      <div className="flex min-h-72 items-center justify-center gap-2 rounded-3xl border border-slate-200 bg-white text-sm text-slate-500 shadow-sm">
        <Loader2 size={18} className="animate-spin" />
        Verifying Stripe and canonical billing evidence…
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

      {data ? <ReadinessBanner data={data} /> : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Endpoint event coverage"
          value={
            data
              ? data.endpoint.enabledEventCount.toLocaleString() +
                "/" +
                data.endpoint.requiredEventCount.toLocaleString()
              : "—"
          }
          detail={
            data
              ? coveragePercent.toLocaleString() +
                "% of required events enabled"
              : "Canonical Stripe endpoint"
          }
        />
        <Metric
          label="Mapped organizations reconciled"
          value={
            data
              ? reconciledMappedOrganizations.toLocaleString() +
                "/" +
                data.ledger.customerCount.toLocaleString()
              : "—"
          }
          detail="BillingCustomer mappings with BillingOrgState sync evidence"
        />
        <Metric
          label="Canonical webhook evidence"
          value={data?.ledger.webhookEventCount.toLocaleString() ?? "—"}
          detail={
            data?.processor.deliveryState === "awaiting_first_event"
              ? "Awaiting first post-cutover Stripe event"
              : "Durable BillingWebhookEvent rows"
          }
        />
        <Metric
          label="Open readiness issues"
          value={
            data
              ? (data.summary.critical + data.summary.warning).toLocaleString()
              : "—"
          }
          detail={
            data
              ? data.summary.critical +
                " critical · " +
                data.summary.warning +
                " warning"
              : "Critical and warning findings"
          }
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Panel
          icon={<ShieldCheck size={17} />}
          title="Platform configuration"
          detail="Presence checks only. Credential values are never returned to the browser."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <CheckRow
              label="Stripe billing enabled"
              ok={Boolean(data?.configuration.billingEnabled)}
            />
            <CheckRow
              label="Processor credential configured"
              ok={Boolean(data?.configuration.processorSecretConfigured)}
            />
            <CheckRow
              label="Webhook verifier configured"
              ok={Boolean(data?.configuration.webhookSecretConfigured)}
            />
            <CheckRow
              label="Canonical endpoint pinned"
              ok={Boolean(data?.configuration.endpointIdConfigured)}
            />
          </div>
          <div className="mt-4 rounded-xl bg-slate-50 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              Canonical public route
            </p>
            <code className="mt-1 block break-all text-xs text-slate-700">
              {data?.configuration.expectedUrl ?? "—"}
            </code>
          </div>
        </Panel>

        <Panel
          icon={<Webhook size={17} />}
          title="Stripe endpoint registration"
          detail="Live Stripe endpoint identity, URL, status, API version, and event coverage."
        >
          <div className="flex flex-wrap gap-2">
            <StatusPill
              ok={Boolean(data?.endpoint.exists)}
              label={
                data?.endpoint.exists ? "Endpoint found" : "Endpoint missing"
              }
            />
            <StatusPill
              ok={Boolean(data?.endpoint.enabled)}
              label={data?.endpoint.enabled ? "Enabled" : "Disabled"}
            />
            <StatusPill
              ok={Boolean(data?.endpoint.matchesExpectedUrl)}
              label={
                data?.endpoint.matchesExpectedUrl
                  ? "URL verified"
                  : "URL mismatch"
              }
            />
            <StatusPill
              ok={Boolean(data?.endpoint.matchesExpectedApiVersion)}
              label={
                data?.endpoint.matchesExpectedApiVersion
                  ? "Version pinned"
                  : "Version drift"
              }
            />
          </div>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <Evidence
              label="API version"
              value={data?.endpoint.apiVersion ?? "—"}
            />
            <Evidence
              label="Created"
              value={formatDate(data?.endpoint.createdAt ?? null)}
            />
            <Evidence
              label="Enabled events"
              value={
                data
                  ? data.endpoint.enabledEventCount +
                    " / " +
                    data.endpoint.requiredEventCount
                  : "—"
              }
            />
            <Evidence
              label="Missing events"
              value={
                data?.endpoint.missingEvents.length.toLocaleString() ?? "—"
              }
            />
          </dl>
          {data?.endpoint.missingEvents.length ? (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3">
              <p className="text-xs font-semibold text-rose-900">
                Required event coverage gap
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {data.endpoint.missingEvents.map((event) => (
                  <code
                    key={event}
                    className="rounded-lg bg-white px-2 py-1 text-[10px] text-rose-700"
                  >
                    {event}
                  </code>
                ))}
              </div>
            </div>
          ) : null}
        </Panel>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Panel
          icon={<Activity size={17} />}
          title="Processor delivery verification"
          detail="Compares enabled Stripe events emitted after canonical endpoint creation with local BillingWebhookEvent evidence."
        >
          {data?.processor.deliveryState === "awaiting_first_event" ? (
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
              <div className="flex items-start gap-3">
                <CircleDashed
                  size={18}
                  className="mt-0.5 shrink-0 text-blue-700"
                />
                <div>
                  <p className="text-sm font-semibold text-blue-950">
                    Awaiting first canonical delivery
                  </p>
                  <p className="mt-1 text-xs leading-5 text-blue-800">
                    No post-cutover Stripe event has been emitted yet for an
                    enabled canonical event type. Delivery health stays
                    explicitly unproven until the first real event arrives.
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {data?.processor.deliveryState === "observed" ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm font-semibold text-emerald-950">
                Canonical delivery observed
              </p>
              <p className="mt-1 text-xs leading-5 text-emerald-800">
                Every relevant Stripe event in the sampled post-cutover window
                has matching local webhook evidence.
              </p>
            </div>
          ) : null}

          {data?.processor.deliveryState === "delivery_gap" ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
              <p className="text-sm font-semibold text-rose-950">
                Processor delivery gap detected
              </p>
              <p className="mt-1 text-xs leading-5 text-rose-800">
                Stripe emitted relevant post-cutover events that are missing
                from the canonical webhook ledger.
              </p>
            </div>
          ) : null}

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <SmallMetric
              label="Recent processor sample"
              value={data?.processor.recentEventSampleCount ?? 0}
            />
            <SmallMetric
              label="Relevant since cutover"
              value={data?.processor.relevantEventsSinceEndpointCreation ?? 0}
            />
            <SmallMetric
              label="Observed locally"
              value={data?.processor.locallyObservedRelevantEvents ?? 0}
            />
            <SmallMetric
              label="Missing locally"
              value={data?.processor.missingLocalDeliveries ?? 0}
              tone={
                (data?.processor.missingLocalDeliveries ?? 0) > 0
                  ? "critical"
                  : "default"
              }
            />
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Latest Stripe account event in sample:{" "}
            <strong>{formatDate(data?.processor.latestEventAt ?? null)}</strong>
          </p>
        </Panel>

        <Panel
          icon={<Database size={17} />}
          title="Canonical ledger"
          detail="Durable billing identity, reconciliation, webhook, and projection evidence."
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <SmallMetric
              label="Billing identities"
              value={data?.ledger.customerCount ?? 0}
            />
            <SmallMetric
              label="Org states"
              value={data?.ledger.orgStateCount ?? 0}
            />
            <SmallMetric
              label="Subscriptions"
              value={data?.ledger.subscriptionCount ?? 0}
            />
            <SmallMetric
              label="Invoices"
              value={data?.ledger.invoiceCount ?? 0}
            />
            <SmallMetric
              label="Webhook rows"
              value={data?.ledger.webhookEventCount ?? 0}
            />
            <SmallMetric
              label="Projections"
              value={data?.ledger.projectionCount ?? 0}
            />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Evidence
              label="Latest reconciliation"
              value={formatDate(data?.ledger.latestSyncAt ?? null)}
            />
            <Evidence
              label="Latest canonical webhook"
              value={formatDate(data?.ledger.latestWebhookAt ?? null)}
            />
          </div>
        </Panel>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 p-5">
          <div className="flex items-center gap-2">
            <Database size={17} className="text-blue-600" />
            <h2 className="text-base font-semibold text-slate-950">
              Organization reconciliation evidence
            </h2>
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Stripe customer mappings and their durable canonical sync state.
            External Stripe customer identifiers are intentionally omitted.
          </p>
        </div>

        {data?.organizations.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-[780px] w-full text-left">
              <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                <tr>
                  <th className="px-5 py-3">Organization</th>
                  <th className="px-4 py-3">Sync state</th>
                  <th className="px-4 py-3">Subscriptions</th>
                  <th className="px-4 py-3">Invoices</th>
                  <th className="px-4 py-3">Last reconciled</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.organizations.map((organization) => (
                  <tr
                    key={organization.orgId}
                    className="text-sm text-slate-700"
                  >
                    <td className="px-5 py-4">
                      <p className="font-semibold text-slate-950">
                        {organization.orgName}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {organization.orgSlug}
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      <StatusPill
                        ok={organization.syncState === "synced"}
                        label={
                          organization.syncState === "synced"
                            ? "Synced"
                            : "Never synced"
                        }
                      />
                    </td>
                    <td className="px-4 py-4">
                      {organization.subscriptionCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-4">
                      {organization.invoiceCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-4 text-xs text-slate-500">
                      {formatDate(organization.lastSyncedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No mapped billing organizations"
            detail="The canonical BillingCustomer ledger currently has no Stripe organization mappings."
          />
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle size={17} className="text-blue-600" />
            <h2 className="text-base font-semibold text-slate-950">
              Readiness findings
            </h2>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Only actionable configuration, delivery, mapping, and ledger
            integrity findings appear here.
          </p>
        </div>

        {data?.issues.length ? (
          <div className="divide-y divide-slate-100">
            {data.issues.map((issue) => (
              <article key={issue.code} className="p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">
                      {issue.title}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      {issue.detail}
                    </p>
                    <code className="mt-2 block text-[10px] text-slate-400">
                      {issue.code}
                    </code>
                  </div>
                  <span
                    className={
                      "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] " +
                      (issue.severity === "critical"
                        ? "bg-rose-50 text-rose-700"
                        : "bg-amber-50 text-amber-700")
                    }
                  >
                    {issue.severity}
                  </span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="p-6">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2
                  size={18}
                  className="mt-0.5 shrink-0 text-emerald-700"
                />
                <div>
                  <p className="text-sm font-semibold text-emerald-950">
                    No readiness defects detected
                  </p>
                  <p className="mt-1 text-xs leading-5 text-emerald-800">
                    Configuration, endpoint coverage, and reconciliation
                    evidence are internally consistent at the last check.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-slate-950 p-5 text-slate-200 shadow-sm">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-300">
          Read-only control-plane guardrail
        </p>
        <p className="mt-2 text-sm font-semibold text-white">
          This surface verifies billing infrastructure; it never performs
          charges, refunds, credits, write-offs, forced collections, or
          subscription changes.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/platform/commerce/revenue"
            className="rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/5"
          >
            Revenue Analytics
          </Link>
          <Link
            href="/platform/commerce/exceptions"
            className="rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/5"
          >
            Revenue Exceptions
          </Link>
          <Link
            href="/platform/billing"
            className="rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/5"
          >
            MigraPay & Billing
          </Link>
        </div>
      </section>
    </div>
  );
}

function ReadinessBanner({ data }: { data: Payload }) {
  const waiting =
    data.overall === "ready" &&
    data.processor.deliveryState === "awaiting_first_event";

  const title = waiting
    ? "Ready · Awaiting first canonical delivery"
    : data.overall === "ready"
      ? "Billing pipeline ready"
      : data.overall === "degraded"
        ? "Billing readiness degraded"
        : "Billing readiness blocked";

  const detail = waiting
    ? "Stripe registration and event coverage are correct, every mapped billing organization is reconciled, and no post-cutover event has been emitted yet. Delivery remains explicitly unproven until the first real event arrives."
    : data.overall === "ready"
      ? "Stripe endpoint, event coverage, canonical delivery evidence, and ledger reconciliation are consistent."
      : "One or more readiness findings require operator attention before the billing pipeline should be treated as healthy.";

  const classes =
    data.overall === "blocked"
      ? "border-rose-200 bg-rose-50 text-rose-900"
      : data.overall === "degraded"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : waiting
          ? "border-blue-200 bg-blue-50 text-blue-900"
          : "border-emerald-200 bg-emerald-50 text-emerald-900";

  return (
    <section className={"rounded-3xl border p-5 " + classes}>
      <div className="flex items-start gap-3">
        {data.overall === "blocked" ? (
          <XCircle size={20} className="mt-0.5 shrink-0" />
        ) : data.overall === "degraded" ? (
          <AlertTriangle size={20} className="mt-0.5 shrink-0" />
        ) : waiting ? (
          <CircleDashed size={20} className="mt-0.5 shrink-0" />
        ) : (
          <CheckCircle2 size={20} className="mt-0.5 shrink-0" />
        )}
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 max-w-4xl text-sm leading-6 opacity-85">
            {detail}
          </p>
          <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.12em] opacity-60">
            Checked {formatDate(data.checkedAt)}
          </p>
        </div>
      </div>
    </section>
  );
}

function Panel({
  icon,
  title,
  detail,
  children,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-5">
        <div className="flex items-center gap-2 text-blue-600">
          {icon}
          <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        </div>
        <p className="mt-1 text-sm leading-6 text-slate-600">{detail}</p>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function CheckRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3">
      <span className="text-xs font-semibold text-slate-700">{label}</span>
      {ok ? (
        <CheckCircle2 size={16} className="shrink-0 text-emerald-600" />
      ) : (
        <XCircle size={16} className="shrink-0 text-rose-600" />
      )}
    </div>
  );
}

function Evidence({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
        {label}
      </dt>
      <dd className="mt-1 break-words text-xs font-semibold text-slate-700">
        {value}
      </dd>
    </div>
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
  tone?: "default" | "critical";
}) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
        {label}
      </p>
      <p
        className={
          "mt-1 text-lg font-semibold " +
          (tone === "critical" ? "text-rose-700" : "text-slate-950")
        }
      >
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="p-6">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <p className="text-sm font-semibold text-slate-950">{title}</p>
        <p className="mt-1 text-xs leading-5 text-slate-600">{detail}</p>
      </div>
    </div>
  );
}
