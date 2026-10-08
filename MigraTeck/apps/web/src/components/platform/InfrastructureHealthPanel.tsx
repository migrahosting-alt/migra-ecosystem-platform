"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  RefreshCw,
  ServerCog,
} from "lucide-react";

type WorkerHealth = {
  key:
    | "provisioning"
    | "entitlement_expiry"
    | "usage"
    | "social_connections"
    | "webhooks";
  label: string;
  state: "healthy" | "stale" | "missing";
  workerId: string | null;
  lastSeenAt: string | null;
  ageSeconds: number | null;
  expectedMaxAgeSeconds: number;
  detail: Record<string, unknown>;
};

type HealthPayload = {
  generatedAt: string;
  summary: {
    workers: number;
    healthyWorkers: number;
    unhealthyWorkers: number;
    provisioningBacklog: number;
    provisioningDeadLetters: number;
    webhookBacklog: number;
    entitlementOverdue: number;
    socialConnectionAttention: number;
    socialReconnectRequired: number;
  };
  workers: WorkerHealth[];
  queues: {
    provisioning: Record<string, unknown>;
    webhooks: Record<string, unknown>;
    usageExports: Record<string, unknown>;
    entitlements: Record<string, unknown>;
    socialConnections: Record<string, unknown>;
  };
};

function ageLabel(seconds: number | null) {
  if (seconds === null) return "No heartbeat";
  if (seconds < 60) return seconds + "s ago";
  if (seconds < 3600) return Math.floor(seconds / 60) + "m ago";
  return Math.floor(seconds / 3600) + "h ago";
}

function stateClasses(state: WorkerHealth["state"]) {
  if (state === "healthy") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (state === "stale") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function InfrastructureHealthPanel() {
  const [data, setData] = useState<HealthPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hiddenForAuthority, setHiddenForAuthority] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (background = false) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/platform/infrastructure/health", {
        cache: "no-store",
      });
      if (response.status === 403) {
        setHiddenForAuthority(true);
        setData(null);
        return;
      }

      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Infrastructure health is unavailable");
      }
      setHiddenForAuthority(false);
      setData(body);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Infrastructure health is unavailable",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (hiddenForAuthority) return null;

  if (loading && !data) {
    return (
      <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3 text-sm font-medium text-slate-600">
          <RefreshCw size={16} className="animate-spin text-blue-600" />
          Verifying background infrastructure…
        </div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">
              Infrastructure health unavailable
            </p>
            <p className="mt-1 text-sm text-amber-900">
              {error ?? "The Platform API could not verify worker liveness."}
            </p>
          </div>
          <button
            onClick={() => void load()}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-amber-800"
          >
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      </section>
    );
  }

  const usageOpen =
    numberValue(data.queues.usageExports.pending) +
    numberValue(data.queues.usageExports.running) +
    numberValue(data.queues.usageExports.retry);
  const usageFailed = numberValue(data.queues.usageExports.failed);
  const socialAttention = numberValue(data.queues.socialConnections.needsAttention);
  const socialReconnect = numberValue(
    data.queues.socialConnections.reconnectRequired,
  );

  const needsAttention =
    data.summary.unhealthyWorkers > 0 ||
    data.summary.provisioningBacklog > 0 ||
    data.summary.webhookBacklog > 0 ||
    usageOpen > 0 ||
    usageFailed > 0 ||
    data.summary.entitlementOverdue > 0 ||
    socialAttention > 0;

  return (
    <section className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-5 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ServerCog size={17} className="text-blue-600" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-700">
              Background infrastructure
            </p>
          </div>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
            Worker & queue health
          </h2>
          <p className="mt-1 max-w-3xl text-[13px] leading-5 text-slate-600 sm:text-sm">
            Heartbeat liveness plus real queue pressure for provisioning, entitlement expiry,
            usage export, and outbound webhooks.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={
              "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold " +
              (needsAttention
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-emerald-200 bg-emerald-50 text-emerald-700")
            }
          >
            {needsAttention ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
            {needsAttention ? "Review recommended" : "All workers healthy"}
          </span>
          <button
            onClick={() => void load(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid gap-px bg-slate-200 md:grid-cols-2 xl:grid-cols-4">
        {data.workers.map((worker) => (
          <article key={worker.key} className="bg-white p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-950">{worker.label}</p>
                <p className="mt-1 truncate text-[11px] text-slate-500">
                  {worker.workerId ?? "Worker identity unavailable"}
                </p>
              </div>
              <span
                className={
                  "rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] " +
                  stateClasses(worker.state)
                }
              >
                {worker.state}
              </span>
            </div>
            <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
              <Clock3 size={13} />
              Last heartbeat {ageLabel(worker.ageSeconds)}
            </div>
          </article>
        ))}
      </div>

      <div className="grid gap-4 border-t border-slate-100 bg-slate-50/70 p-5 sm:p-6 md:grid-cols-2 xl:grid-cols-5">
        <QueueCard
          title="Provisioning"
          value={data.summary.provisioningBacklog}
          detail={
            data.summary.provisioningDeadLetters +
            " historical dead letter" +
            (data.summary.provisioningDeadLetters === 1 ? "" : "s")
          }
          href="/platform/commerce/catalog"
          alert={data.summary.provisioningBacklog > 0}
        />
        <QueueCard
          title="Webhooks"
          value={data.summary.webhookBacklog}
          detail={numberValue(data.queues.webhooks.failed) + " failed deliveries"}
          href="/platform/developers/webhooks"
          alert={
            data.summary.webhookBacklog > 0 ||
            numberValue(data.queues.webhooks.failed) > 0
          }
        />
        <QueueCard
          title="Usage export"
          value={usageOpen}
          detail={usageFailed + " terminal export failures"}
          href="/platform/commerce/usage"
          alert={usageOpen > 0 || usageFailed > 0}
        />
        <QueueCard
          title="Entitlement expiry"
          value={data.summary.entitlementOverdue}
          detail={numberValue(data.queues.entitlements.active) + " active entitlements"}
          href="/platform/commerce/catalog"
          alert={data.summary.entitlementOverdue > 0}
        />
        <article
          className={
            "rounded-2xl border bg-white p-4 " +
            (socialAttention > 0 ? "border-amber-200" : "border-slate-200")
          }
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Social connections
          </p>
          <p
            className={
              "mt-2 text-xl font-semibold " +
              (socialAttention > 0 ? "text-amber-800" : "text-slate-950")
            }
          >
            {socialAttention.toLocaleString()}
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {socialReconnect} reconnect required · worker-managed sync
          </p>
        </article>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-[11px] text-slate-500 sm:px-6">
        <span>Snapshot {new Date(data.generatedAt).toLocaleString()}</span>
        <span className="inline-flex items-center gap-1.5">
          <Activity size={12} /> Live control-plane evidence
        </span>
      </div>
    </section>
  );
}

function QueueCard({
  title,
  value,
  detail,
  href,
  alert,
}: {
  title: string;
  value: number;
  detail: string;
  href: string;
  alert: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        "rounded-2xl border bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-sm " +
        (alert ? "border-amber-200" : "border-slate-200")
      }
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        {title}
      </p>
      <p className={"mt-2 text-xl font-semibold " + (alert ? "text-amber-800" : "text-slate-950")}>
        {value.toLocaleString()}
      </p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
    </Link>
  );
}
