"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Gauge,
  KeyRound,
  Loader2,
  RefreshCw,
  Route,
  ShieldCheck,
  XCircle,
} from "lucide-react";

type UsageWindow = "24h" | "7d" | "30d";

type UsagePayload = {
  organization: {
    id: string;
    name: string;
    slug: string;
    role: string;
  };
  window: UsageWindow;
  summary: {
    requests: number;
    successful: number;
    successRate: number | null;
    clientErrors: number;
    serverErrors: number;
    rateLimited: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
  };
  credentials: {
    active: number;
    revoked: number;
    expired: number;
  };
  byKey: Array<{
    apiKeyId: string | null;
    publicKeyId: string | null;
    keyName: string | null;
    requests: number;
    successful: number;
    errors: number;
    avgLatencyMs: number;
    lastSeenAt: string | null;
  }>;
  topRoutes: Array<{
    method: string | null;
    route: string | null;
    requests: number;
    errors: number;
    avgLatencyMs: number;
  }>;
  recent: Array<{
    id: string;
    timestamp: string;
    apiKeyId: string | null;
    publicKeyId: string | null;
    keyName: string | null;
    method: string | null;
    route: string | null;
    statusCode: number;
    durationMs: number;
    requestId: string | null;
    rateLimited: boolean;
  }>;
  quotas: Array<{
    id: string;
    product: string;
    metric: string;
    limitValue: string;
    currentUsed: string;
    periodStart: string;
    periodEnd: string;
    updatedAt: string;
  }>;
  rateLimitPolicy: {
    apiKeyRequestsPerMinute: number;
    anonymousIpRequestsPerMinute: number;
  };
};

const windowOptions: Array<{ value: UsageWindow; label: string }> = [
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function requestHealthClass(statusCode: number) {
  if (statusCode >= 500) return "bg-rose-50 text-rose-700";
  if (statusCode >= 400) return "bg-amber-50 text-amber-700";
  if (statusCode >= 200 && statusCode < 400) return "bg-emerald-50 text-emerald-700";
  return "bg-slate-100 text-slate-600";
}

function methodClass(method: string | null) {
  if (method === "GET") return "bg-blue-50 text-blue-700";
  if (method === "POST") return "bg-emerald-50 text-emerald-700";
  if (method === "PATCH" || method === "PUT") return "bg-amber-50 text-amber-700";
  if (method === "DELETE") return "bg-rose-50 text-rose-700";
  return "bg-slate-100 text-slate-600";
}

function percent(part: number, total: number) {
  if (!total) return 0;
  return Math.round((part / total) * 10000) / 100;
}

export function ApiUsageWorkspace() {
  const [window, setWindow] = useState<UsageWindow>("24h");
  const [data, setData] = useState<UsagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (selected: UsageWindow, background = false) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        "/api/platform/developer/usage?window=" + encodeURIComponent(selected),
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? body.message ?? "Unable to load API usage");
      }
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load API usage");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(window);
  }, [load, window]);

  const totalCredentialStates = useMemo(() => {
    if (!data) return 0;
    return data.credentials.active + data.credentials.revoked + data.credentials.expired;
  }, [data]);

  if (loading && !data) {
    return (
      <div className="grid min-h-72 place-items-center rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 text-sm font-medium text-slate-600">
          <Loader2 size={18} className="animate-spin text-blue-600" />
          Loading API observability…
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <section className="rounded-3xl border border-rose-200 bg-rose-50 p-6">
        <h2 className="font-semibold text-rose-950">API usage is unavailable</h2>
        <p className="mt-2 text-sm leading-6 text-rose-800">{error ?? "No usage context is available."}</p>
        <button
          onClick={() => void load(window)}
          className="mt-4 inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-800"
        >
          <RefreshCw size={15} /> Retry
        </button>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
          {error}
        </div>
      ) : null}

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Observation window</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">{data.organization.name}</h2>
            <p className="mt-1 text-sm text-slate-600">
              Organization role: <span className="font-semibold text-slate-800">{data.organization.role}</span>
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="grid grid-cols-3 rounded-xl border border-slate-200 bg-slate-50 p-1">
              {windowOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setWindow(option.value)}
                  className={
                    "rounded-lg px-3 py-2 text-xs font-semibold transition " +
                    (window === option.value
                      ? "bg-white text-slate-950 shadow-sm"
                      : "text-slate-500 hover:text-slate-800")
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => void load(window, true)}
              disabled={refreshing}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<Activity size={18} />}
          label="Requests"
          value={data.summary.requests.toLocaleString()}
          detail={data.summary.requests ? "credential-attributed API calls" : "no machine traffic yet"}
        />
        <MetricCard
          icon={<CheckCircle2 size={18} />}
          label="Success rate"
          value={data.summary.successRate === null ? "—" : data.summary.successRate.toFixed(2) + "%"}
          detail={data.summary.successful.toLocaleString() + " successful responses"}
        />
        <MetricCard
          icon={<Clock3 size={18} />}
          label="p95 latency"
          value={data.summary.requests ? data.summary.p95LatencyMs.toLocaleString() + " ms" : "—"}
          detail={"Average " + data.summary.avgLatencyMs.toLocaleString() + " ms"}
        />
        <MetricCard
          icon={<AlertTriangle size={18} />}
          label="Request errors"
          value={(data.summary.clientErrors + data.summary.serverErrors).toLocaleString()}
          detail={
            data.summary.clientErrors +
            " client / " +
            data.summary.serverErrors +
            " server / " +
            data.summary.rateLimited +
            " throttled"
          }
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Machine credentials</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">Usage by API key</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Attribute traffic and failures to the exact machine credential without exposing the secret.
            </p>
          </div>

          {data.byKey.length === 0 ? (
            <EmptyPanel
              icon={<KeyRound size={21} />}
              title="No credential-attributed traffic yet"
              description="Create an API key with a machine-readable scope, call the Platform API, and request evidence will appear here automatically."
            />
          ) : (
            <div className="divide-y divide-slate-100">
              {data.byKey.map((item) => {
                const successRate = percent(item.successful, item.requests);
                return (
                  <article key={item.apiKeyId ?? item.publicKeyId ?? item.keyName ?? "unknown"} className="p-5 sm:p-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-slate-950">{item.keyName ?? "Unnamed credential"}</h3>
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-blue-700">
                            API key
                          </span>
                        </div>
                        <code className="mt-2 block break-all text-xs font-medium text-slate-500">
                          {item.publicKeyId ?? "unknown public key id"}
                        </code>
                        <p className="mt-2 text-xs text-slate-500">Last seen {formatDate(item.lastSeenAt)}</p>
                      </div>
                      <div className="grid grid-cols-3 gap-2 sm:min-w-64">
                        <MiniStat label="Requests" value={item.requests.toLocaleString()} />
                        <MiniStat label="Success" value={successRate.toFixed(1) + "%"} />
                        <MiniStat label="Avg latency" value={item.avgLatencyMs.toLocaleString() + " ms"} />
                      </div>
                    </div>
                    {item.errors > 0 ? (
                      <div className="mt-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                        <AlertTriangle size={14} /> {item.errors} request{item.errors === 1 ? "" : "s"} returned an error response.
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">Credential health</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">Keys & rate policy</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Operational controls for machine traffic are separate from commercial product quotas.
            </p>
          </div>
          <div className="space-y-5 p-5 sm:p-6">
            <div className="grid grid-cols-3 gap-2">
              <MiniStat label="Active" value={data.credentials.active.toString()} />
              <MiniStat label="Revoked" value={data.credentials.revoked.toString()} />
              <MiniStat label="Expired" value={data.credentials.expired.toString()} />
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2">
                <Gauge size={16} className="text-violet-600" />
                <h3 className="text-sm font-semibold text-slate-900">Per-key throttle</h3>
              </div>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                {data.rateLimitPolicy.apiKeyRequestsPerMinute.toLocaleString()}
                <span className="ml-1 text-sm font-medium text-slate-500">requests / minute</span>
              </p>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Valid API keys receive independent buckets. Anonymous/browser traffic remains protected at{" "}
                {data.rateLimitPolicy.anonymousIpRequestsPerMinute.toLocaleString()} requests per minute per IP.
              </p>
            </div>

            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="flex items-center gap-2 text-emerald-800">
                <ShieldCheck size={16} />
                <h3 className="text-sm font-semibold">Telemetry privacy boundary</h3>
              </div>
              <p className="mt-2 text-xs leading-5 text-emerald-800">
                Query strings and API secrets are excluded. Route pattern, method, status, latency, request ID, and public credential identity are retained.
              </p>
            </div>

            {totalCredentialStates === 0 ? (
              <p className="text-xs leading-5 text-slate-500">No organization API keys have been issued yet.</p>
            ) : null}
          </div>
        </section>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Route behavior</p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">Most-used API routes</h2>
          <p className="mt-1 text-sm text-slate-600">Route-pattern aggregation avoids storing request query parameters.</p>
        </div>

        {data.topRoutes.length === 0 ? (
          <EmptyPanel
            icon={<Route size={21} />}
            title="No route telemetry yet"
            description="Machine API calls will be grouped here by method and registered route pattern."
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {data.topRoutes.map((route, index) => (
              <article key={(route.method ?? "") + ":" + (route.route ?? "") + ":" + index} className="grid gap-3 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={"rounded-lg px-2 py-1 text-[10px] font-bold " + methodClass(route.method)}>
                      {route.method ?? "?"}
                    </span>
                    <code className="min-w-0 truncate text-xs font-semibold text-slate-800">{route.route ?? "unknown route"}</code>
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
                  <span><strong className="text-slate-800">{route.requests}</strong> requests</span>
                  <span><strong className="text-slate-800">{route.errors}</strong> errors</span>
                  <span><strong className="text-slate-800">{route.avgLatencyMs}</strong> ms avg</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Request evidence</p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">Recent API requests</h2>
          <p className="mt-1 text-sm text-slate-600">Latest credential-attributed machine requests for the selected window.</p>
        </div>

        {data.recent.length === 0 ? (
          <EmptyPanel
            icon={<Activity size={21} />}
            title="No API requests recorded"
            description="This is expected until a valid API key is used against a machine-facing Platform API route."
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {data.recent.map((request) => (
              <article key={request.id} className="p-5 sm:px-6">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={"rounded-lg px-2 py-1 text-[10px] font-bold " + methodClass(request.method)}>
                        {request.method ?? "?"}
                      </span>
                      <code className="max-w-full truncate text-xs font-semibold text-slate-800">{request.route ?? "unknown route"}</code>
                      <span className={"rounded-full px-2 py-0.5 text-[10px] font-bold " + requestHealthClass(request.statusCode)}>
                        {request.statusCode || "—"}
                      </span>
                      {request.rateLimited ? (
                        <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">Rate limited</span>
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span>{request.keyName ?? "Unknown key"}</span>
                      <span>{request.publicKeyId ?? "No public key id"}</span>
                      <span>{formatDate(request.timestamp)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                    <span><strong className="text-slate-800">{request.durationMs}</strong> ms</span>
                    <span>Request <code className="font-semibold text-slate-700">{request.requestId ?? "—"}</code></span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Commercial boundaries</p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">Persisted usage quotas</h2>
          <p className="mt-1 text-sm text-slate-600">
            Product quotas come from the commercial entitlement layer and are shown here only when they constrain developer traffic.
          </p>
        </div>

        {data.quotas.length === 0 ? (
          <EmptyPanel
            icon={<Gauge size={21} />}
            title="No persisted product quotas"
            description="No UsageQuota rows are attached to this organization. Operational API throttling still applies independently."
          />
        ) : (
          <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6 xl:grid-cols-3">
            {data.quotas.map((quota) => {
              const used = Number(quota.currentUsed);
              const limit = Number(quota.limitValue);
              const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 1000) / 10) : 0;
              return (
                <article key={quota.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-slate-900">{quota.product}</p>
                      <p className="mt-1 text-[11px] font-medium text-slate-500">{quota.metric}</p>
                    </div>
                    <span className="text-xs font-semibold text-slate-700">{pct}%</span>
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-slate-900" style={{ width: pct + "%" }} />
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                    <span>{used.toLocaleString()} used</span>
                    <span>{limit.toLocaleString()} limit</span>
                  </div>
                  <p className="mt-3 text-[11px] text-slate-400">Ends {formatDate(quota.periodEnd)}</p>
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
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-slate-500">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-[0.14em]">{label}</span>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
    </article>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function EmptyPanel({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="grid min-h-44 place-items-center px-6 py-10 text-center">
      <div>
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-slate-100 text-slate-500">
          {icon}
        </span>
        <h3 className="mt-3 text-sm font-semibold text-slate-900">{title}</h3>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{description}</p>
      </div>
    </div>
  );
}
