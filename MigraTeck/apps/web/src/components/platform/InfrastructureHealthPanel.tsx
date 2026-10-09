"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  GitCommit,
  HardDrive,
  MemoryStick,
  PackageCheck,
  RefreshCw,
  ServerCog,
} from "lucide-react";

type WorkerHealth = {
  key:
    | "provisioning"
    | "entitlement_expiry"
    | "usage"
    | "billing_reconciliation"
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

type ReleaseIntegrity = {
  key: "platform_api" | "platform_web";
  label: string;
  state: "verified" | "drift" | "missing" | "invalid";
  service: string | null;
  kind: "build" | "baseline" | null;
  commit: string | null;
  dirty: boolean | null;
  builtAt: string | null;
  deploymentPath: string | null;
  sourceMatches: boolean | null;
  artifactMatches: boolean | null;
  detail: string;
};

type HealthPayload = {
  generatedAt: string;
  summary: {
    workers: number;
    healthyWorkers: number;
    unhealthyWorkers: number;
    provisioningBacklog: number;
    provisioningDeadLetters: number;
    provisioningDriftNeedsVerification: number;
    webhookBacklog: number;
    entitlementOverdue: number;
    socialConnectionAttention: number;
    socialReconnectRequired: number;
    releaseIntegrityIssues: number;
    releaseOverlayState: "managed" | "missing" | "invalid";
    releaseOverlayDifferences: number;
    releaseOverlayRuntimeReconciliation: number;
    releaseOverlayHighCriticality: number;
    releaseOverlayIntentionalExclusions: number;
    releaseOverlayOverdueExclusions: number;
    hostCapacityState: "healthy" | "warning" | "critical";
    diskUsedPercent: number;
    diskAvailableBytes: number;
  };
  workers: WorkerHealth[];
  releases: ReleaseIntegrity[];
  overlay: {
    state: "managed" | "missing" | "invalid";
    generatedAt: string | null;
    canonicalCommit: string | null;
    releaseLabel: string | null;
    installedReleaseLabel: string | null;
    summary: {
      totalDifferences: number;
      productionOnly: number;
      modifiedCanonical: number;
      missingCanonical: number;
      runtimeReconciliation: number;
      highCriticality: number;
      intentionalExclusions: number;
      overdueExclusions: number;
    };
    byClassification: Record<string, number>;
    byAction: Record<string, number>;
    samples: Array<{
      path: string;
      kind: "extra" | "modified" | "missing";
      classification: string;
      criticality: "low" | "medium" | "high";
      recommendedAction: string;
      policyDecision?: "intentionally_excluded";
      policyGroup?: string;
      policyOwner?: string;
      policyReason?: string;
      policyReviewAfter?: string;
      policyOverdue?: boolean;
    }>;
    detail: string;
  };
  host: {
    state: "healthy" | "warning" | "critical";
    checkedPath: string;
    disk: {
      totalBytes: number;
      availableBytes: number;
      usedBytes: number;
      usedPercent: number;
      warningPercent: number;
      criticalPercent: number;
      warningFreeBytes: number;
      criticalFreeBytes: number;
    };
    memory: {
      totalBytes: number;
      freeBytes: number;
      usedBytes: number;
      usedPercent: number;
    };
    loadAverage: {
      oneMinute: number;
      fiveMinutes: number;
      fifteenMinutes: number;
    };
    releases: {
      root: string;
      count: number;
      activePath: string | null;
      activeName: string | null;
      newest: Array<{ name: string; modifiedAt: string }>;
      error: string | null;
    };
    reasons: string[];
  };
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

function releaseStateClasses(state: ReleaseIntegrity["state"]) {
  if (state === "verified") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (state === "drift") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function shortCommit(commit: string | null) {
  if (!commit) return "Unknown commit";
  return /^[a-f0-9]{7,40}$/i.test(commit) ? commit.slice(0, 10) : commit;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return value.toFixed(index >= 3 ? 1 : 0) + " " + units[index];
}

function capacityStateClasses(state: HealthPayload["host"]["state"]) {
  if (state === "healthy") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (state === "warning") return "border-amber-200 bg-amber-50 text-amber-800";
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
    data.summary.provisioningDriftNeedsVerification > 0 ||
    data.summary.webhookBacklog > 0 ||
    usageOpen > 0 ||
    usageFailed > 0 ||
    data.summary.entitlementOverdue > 0 ||
    data.summary.releaseIntegrityIssues > 0 ||
    data.summary.releaseOverlayState !== "managed" ||
    data.summary.releaseOverlayRuntimeReconciliation > 0 ||
    data.summary.releaseOverlayOverdueExclusions > 0 ||
    data.summary.hostCapacityState !== "healthy" ||
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

      <div className="border-t border-slate-100 px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <HardDrive size={16} className="text-cyan-600" />
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-700">
                Runtime capacity
              </p>
            </div>
            <h3 className="mt-1 text-sm font-semibold text-slate-950">
              Host headroom & release pressure
            </h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Filesystem headroom, memory pressure, and release inventory on the host running the Platform API.
            </p>
          </div>
          <span
            className={
              "rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] " +
              capacityStateClasses(data.host.state)
            }
          >
            {data.host.state}
          </span>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-2 text-slate-600">
              <HardDrive size={15} />
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em]">Disk usage</p>
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
              {data.host.disk.usedPercent.toFixed(1)}%
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              {formatBytes(data.host.disk.availableBytes)} available of {formatBytes(data.host.disk.totalBytes)}
            </p>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-2 text-slate-600">
              <MemoryStick size={15} />
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em]">Memory</p>
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
              {data.host.memory.usedPercent.toFixed(1)}%
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              {formatBytes(data.host.memory.freeBytes)} free of {formatBytes(data.host.memory.totalBytes)}
            </p>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              Release inventory
            </p>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
              {data.host.releases.count}
            </p>
            <p className="mt-1 truncate text-[11px] text-slate-500">
              Active: {data.host.releases.activeName ?? "unknown"}
            </p>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              Load average
            </p>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
              {data.host.loadAverage.oneMinute.toFixed(2)}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              5m {data.host.loadAverage.fiveMinutes.toFixed(2)} · 15m {data.host.loadAverage.fifteenMinutes.toFixed(2)}
            </p>
          </article>
        </div>

        {data.host.reasons.length > 0 ? (
          <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
            <div className="flex items-start gap-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-rose-700" />
              <div>
                <p className="text-xs font-semibold text-rose-900">
                  Capacity intervention required
                </p>
                <ul className="mt-1 space-y-1 text-[11px] leading-5 text-rose-800">
                  {data.host.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="border-t border-slate-100 px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <PackageCheck size={16} className="text-violet-600" />
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-700">
                Release integrity
              </p>
            </div>
            <h3 className="mt-1 text-sm font-semibold text-slate-950">
              Source and compiled build provenance
            </h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Detects source-only hotfixes, stale compiled output, and runtimes without a signed-off build manifest.
            </p>
          </div>
          <span className="text-xs font-semibold text-slate-500">
            {data.summary.releaseIntegrityIssues === 0
              ? "All release fingerprints verified"
              : data.summary.releaseIntegrityIssues + " runtime" +
                (data.summary.releaseIntegrityIssues === 1 ? "" : "s") +
                " need review"}
          </span>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {data.releases.map((release) => (
            <article
              key={release.key}
              className={
                "rounded-2xl border p-4 " +
                (release.state === "verified"
                  ? "border-slate-200 bg-slate-50"
                  : "border-amber-200 bg-amber-50/70")
              }
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-950">{release.label}</p>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
                    <GitCommit size={12} />
                    <code className="font-semibold text-slate-700">
                      {shortCommit(release.commit)}
                    </code>
                    {release.kind === "baseline" ? (
                      <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-violet-800">
                        baseline
                      </span>
                    ) : null}
                    {release.dirty ? (
                      <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-800">
                        {release.kind === "baseline" ? "mixed runtime" : "dirty build"}
                      </span>
                    ) : null}
                  </div>
                </div>
                <span
                  className={
                    "rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] " +
                    releaseStateClasses(release.state)
                  }
                >
                  {release.state}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded-xl border border-white/80 bg-white/80 px-3 py-2">
                  <p className="font-semibold text-slate-700">Source</p>
                  <p className={release.sourceMatches === true ? "mt-1 text-emerald-700" : "mt-1 text-amber-800"}>
                    {release.sourceMatches === null
                      ? "Not verified"
                      : release.sourceMatches
                        ? "Fingerprint matches"
                        : "Fingerprint drift"}
                  </p>
                </div>
                <div className="rounded-xl border border-white/80 bg-white/80 px-3 py-2">
                  <p className="font-semibold text-slate-700">Compiled output</p>
                  <p className={release.artifactMatches === true ? "mt-1 text-emerald-700" : "mt-1 text-amber-800"}>
                    {release.artifactMatches === null
                      ? "Not verified"
                      : release.artifactMatches
                        ? "Fingerprint matches"
                        : "Fingerprint drift"}
                  </p>
                </div>
              </div>

              <p className="mt-3 text-[11px] leading-5 text-slate-500">
                {release.detail}
              </p>
              {release.builtAt ? (
                <p className="mt-1 text-[10px] text-slate-400">
                  Built {new Date(release.builtAt).toLocaleString()}
                </p>
              ) : null}
            </article>
          ))}
        </div>

        <article
          className={
            "mt-4 rounded-2xl border p-4 " +
            (data.overlay.state !== "managed" ||
            data.overlay.summary.runtimeReconciliation > 0 ||
            data.overlay.summary.overdueExclusions > 0
              ? "border-amber-200 bg-amber-50/70"
              : "border-violet-200 bg-violet-50/60")
          }
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-700">
                Release overlay policy
              </p>
              <h4 className="mt-1 text-sm font-semibold text-slate-950">
                Runtime source reconciliation
              </h4>
              <p className="mt-1 max-w-4xl text-[11px] leading-5 text-slate-600">
                {data.overlay.detail}
              </p>
            </div>
            <span
              className={
                "w-fit rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.1em] " +
                (data.overlay.state === "managed"
                  ? "border-violet-200 bg-white text-violet-700"
                  : "border-amber-200 bg-amber-100 text-amber-800")
              }
            >
              {data.overlay.state}
            </span>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {[
              [
                "Unresolved runtime",
                data.overlay.summary.runtimeReconciliation,
                data.overlay.summary.runtimeReconciliation > 0,
              ],
              [
                "Intentional exclusions",
                data.overlay.summary.intentionalExclusions,
                false,
              ],
              [
                "Overdue reviews",
                data.overlay.summary.overdueExclusions,
                data.overlay.summary.overdueExclusions > 0,
              ],
              [
                "High criticality",
                data.overlay.summary.highCriticality,
                data.overlay.summary.highCriticality > 0,
              ],
              ["Total differences", data.overlay.summary.totalDifferences, false],
            ].map(([label, value, alert]) => (
              <div
                key={String(label)}
                className={
                  "rounded-xl border bg-white px-3 py-2.5 " +
                  (alert ? "border-amber-200" : "border-violet-100")
                }
              >
                <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">
                  {label}
                </p>
                <p
                  className={
                    "mt-1 text-lg font-semibold " +
                    (alert ? "text-amber-800" : "text-slate-950")
                  }
                >
                  {Number(value).toLocaleString()}
                </p>
              </div>
            ))}
          </div>

          <p className="mt-3 text-[10px] leading-5 text-slate-500">
            Canonical {shortCommit(data.overlay.canonicalCommit)} · installed {data.overlay.installedReleaseLabel ?? "unknown release"}
          </p>
        </article>
      </div>

      <div className="grid gap-4 border-t border-slate-100 bg-slate-50/70 p-5 sm:p-6 md:grid-cols-2 xl:grid-cols-5">
        <QueueCard
          title="Provisioning verification"
          value={data.summary.provisioningDriftNeedsVerification}
          detail={
            data.summary.provisioningBacklog +
            " open queue · " +
            data.summary.provisioningDeadLetters +
            " dead-letter job" +
            (data.summary.provisioningDeadLetters === 1 ? "" : "s")
          }
          href="/platform/commerce/catalog"
          alert={
            data.summary.provisioningBacklog > 0 ||
            data.summary.provisioningDriftNeedsVerification > 0
          }
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
