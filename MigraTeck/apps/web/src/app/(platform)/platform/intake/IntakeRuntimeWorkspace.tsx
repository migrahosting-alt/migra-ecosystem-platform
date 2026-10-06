"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Archive,
  Database,
  ExternalLink,
  FileStack,
  HardDrive,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

type IntakeRuntimePayload = {
  authority: {
    roles: string[];
    permissions: string[];
    viaBootstrap: boolean;
  };
  runtime: {
    mode: "legacy_global";
    tenantScoped: false;
    health: {
      reachable: boolean;
      statusCode: number;
      status: string;
      service: string;
      version: string | null;
      features: Record<string, unknown>;
      storage: Record<string, unknown>;
      error?: string;
    };
    portalUrl: string;
    adminPortalUrl: string;
  };
  legacy: {
    projects: Array<{
      id: string;
      name: string;
      status: string;
      type: string | null;
      templateKey: string | null;
      templateLabel: string | null;
      tier: string | null;
      source: string | null;
      submissionsCount: number;
      leadScore: number | null;
      createdAt: string | null;
      updatedAt: string | null;
      lastActivity: string | null;
      dueDate: string | null;
    }>;
    counts: {
      projects: number;
      submissions: number;
      uploads: number;
      backups: number;
    };
    projectStatus: Record<string, number>;
    projectTier: Record<string, number>;
    storage: {
      uploadsBytes: number;
      intakePayloadBytes: number;
    };
    backups: {
      latestAt: string | null;
      latestName: string | null;
    };
  };
  boundary: {
    attribution: string;
    writes: string;
    migrationTarget: string;
    migrationTargetReady: boolean;
    migrationBlockers: string[];
  };
};

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  return value.toFixed(exponent === 0 || value >= 10 ? 0 : 1) + " " + units[exponent];
}

function formatDate(value: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function badgeClass(status: string) {
  const normalized = status.toLowerCase();
  if (["ok", "healthy", "active", "complete", "completed"].includes(normalized)) {
    return "bg-emerald-50 text-emerald-700";
  }
  if (["new", "pending", "draft", "in_progress", "in progress"].includes(normalized)) {
    return "bg-blue-50 text-blue-700";
  }
  if (["failed", "error", "blocked", "cancelled"].includes(normalized)) {
    return "bg-rose-50 text-rose-700";
  }
  return "bg-slate-100 text-slate-600";
}

export function IntakeRuntimeWorkspace() {
  const [data, setData] = useState<IntakeRuntimePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (background = false) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/platform/intake/runtime", {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Unable to load MigraIntake runtime");
      }
      setData(body);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load MigraIntake runtime",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const statusEntries = useMemo(
    () =>
      Object.entries(data?.legacy.projectStatus ?? {}).sort(
        (left, right) => right[1] - left[1],
      ),
    [data],
  );

  if (loading && !data) {
    return (
      <section className="grid min-h-72 place-items-center rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 text-sm font-medium text-slate-600">
          <Loader2 size={18} className="animate-spin text-blue-600" />
          Loading MigraIntake runtime…
        </div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <ShieldAlert size={20} className="mt-0.5 shrink-0 text-amber-700" />
          <div>
            <h2 className="font-semibold text-amber-950">
              Global Intake runtime is restricted
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-amber-800">
              {error ??
                "MigraTeck platform operator authority is required to inspect the global legacy runtime."}
            </p>
            <button
              onClick={() => void load()}
              className="mt-4 inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-white px-4 py-2.5 text-sm font-semibold text-amber-900"
            >
              <RefreshCw size={15} /> Retry
            </button>
          </div>
        </div>
      </section>
    );
  }

  const health = data.runtime.health;
  const storageConfigured = health.storage?.configured === true;
  const featureEntries = Object.entries(health.features ?? {});

  return (
    <div className="space-y-6">
      {data.authority.viaBootstrap ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This view is using MigraAuth bootstrap authority. Grant a persistent
          platform role before removing the bootstrap path.
        </div>
      ) : null}

      <section className="rounded-3xl border border-slate-200 bg-[radial-gradient(circle_at_10%_10%,rgba(59,130,246,.08),transparent_32%),linear-gradient(135deg,#ffffff,#f8fafc)] p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={
                  "rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.13em] " +
                  (health.reachable
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-rose-50 text-rose-700")
                }
              >
                {health.reachable ? "Runtime online" : "Runtime unavailable"}
              </span>
              <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.13em] text-violet-700">
                Global legacy
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.13em] text-slate-600">
                Read only here
              </span>
            </div>
            <h2 className="mt-3 text-xl font-semibold tracking-tight text-slate-950">
              {health.service} runtime
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              This production instance predates tenant isolation. MigraTeck can
              inspect its operational state globally, but the Platform does not
              infer customer ownership from project names, emails, or public
              intake links.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void load(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw
                size={15}
                className={refreshing ? "animate-spin" : ""}
              />
              Refresh
            </button>
            <a
              href={data.runtime.adminPortalUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-3.5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Operate legacy portal <ExternalLink size={14} />
            </a>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <RuntimeMetric
            icon={<FileStack size={17} />}
            label="Projects"
            value={data.legacy.counts.projects.toLocaleString()}
            detail="global legacy projects"
          />
          <RuntimeMetric
            icon={<Activity size={17} />}
            label="Submissions"
            value={data.legacy.counts.submissions.toLocaleString()}
            detail="stored intake payloads"
          />
          <RuntimeMetric
            icon={<HardDrive size={17} />}
            label="Uploads"
            value={formatBytes(data.legacy.storage.uploadsBytes)}
            detail={data.legacy.counts.uploads + " stored files"}
          />
          <RuntimeMetric
            icon={<Archive size={17} />}
            label="Backups"
            value={data.legacy.counts.backups.toLocaleString()}
            detail={
              data.legacy.backups.latestAt
                ? "latest " + formatDate(data.legacy.backups.latestAt)
                : "no backup artifact found"
            }
          />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-end justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
                Legacy inventory
              </p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
                Active project surface
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Sanitized project metadata only. Submission answers and file
                paths never enter this control plane.
              </p>
            </div>
          </div>

          {data.legacy.projects.length === 0 ? (
            <div className="grid min-h-48 place-items-center p-8 text-center">
              <p className="text-sm text-slate-500">
                No legacy projects are present.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {data.legacy.projects.map((project) => (
                <article key={project.id} className="p-5 sm:px-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-slate-950">
                          {project.name}
                        </h3>
                        <span
                          className={
                            "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] " +
                            badgeClass(project.status)
                          }
                        >
                          {project.status}
                        </span>
                        {project.tier ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                            {project.tier}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        {project.templateLabel ??
                          project.templateKey ??
                          project.type ??
                          "General intake"}
                      </p>
                    </div>
                    <div className="grid shrink-0 grid-cols-2 gap-2 sm:min-w-48">
                      <MiniStat
                        label="Submissions"
                        value={project.submissionsCount.toString()}
                      />
                      <MiniStat
                        label="Lead score"
                        value={
                          project.leadScore === null
                            ? "—"
                            : project.leadScore.toString()
                        }
                      />
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-400">
                    <span>Last activity {formatDate(project.lastActivity)}</span>
                    {project.dueDate ? (
                      <span>Due {formatDate(project.dueDate)}</span>
                    ) : null}
                    {project.source ? <span>Source {project.source}</span> : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <div className="space-y-6">
          <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">
                Service posture
              </p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
                Health & storage
              </h2>
            </div>
            <div className="space-y-3 p-5 sm:p-6">
              <PostureRow
                label="Health endpoint"
                value={health.reachable ? health.status : "unreachable"}
                ok={health.reachable}
              />
              <PostureRow
                label="Version"
                value={health.version ?? "unknown"}
                ok={Boolean(health.version)}
              />
              <PostureRow
                label="Attachment storage"
                value={
                  storageConfigured
                    ? String(health.storage.backend ?? "configured")
                    : "filesystem"
                }
                ok
              />
              <PostureRow
                label="Tenant isolation"
                value="not present"
                ok={false}
              />

              {featureEntries.length ? (
                <div className="border-t border-slate-100 pt-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                    Reported features
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {featureEntries.map(([feature, enabled]) => (
                      <span
                        key={feature}
                        className={
                          "rounded-full px-2.5 py-1 text-[10px] font-semibold " +
                          (enabled
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-slate-100 text-slate-500")
                        }
                      >
                        {feature.replace(/([A-Z])/g, " $1")}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <section className="rounded-3xl border border-amber-200 bg-amber-50 shadow-sm">
            <div className="p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <ShieldAlert
                  size={19}
                  className="mt-0.5 shrink-0 text-amber-700"
                />
                <div>
                  <h2 className="text-sm font-semibold text-amber-950">
                    Migration boundary
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-amber-900">
                    {data.boundary.attribution}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-amber-900">
                    {data.boundary.writes}
                  </p>
                  <div className="mt-4 space-y-2">
                    {data.boundary.migrationBlockers.map((blocker) => (
                      <div
                        key={blocker}
                        className="flex items-start gap-2 text-xs leading-5 text-amber-800"
                      >
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                        <span>{blocker}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center gap-2">
              <Database size={16} className="text-violet-600" />
              <h2 className="text-sm font-semibold text-slate-950">
                Project status mix
              </h2>
            </div>
            {statusEntries.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500">
                No project status data is available.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {statusEntries.map(([status, count]) => (
                  <div
                    key={status}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="text-xs font-medium capitalize text-slate-600">
                      {status.replace(/_/g, " ")}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-800">
                      {count}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function RuntimeMetric({
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
    <div className="rounded-2xl border border-slate-200 bg-white/90 p-4">
      <div className="flex items-center gap-2 text-slate-500">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em]">
          {label}
        </span>
      </div>
      <p className="mt-2 text-xl font-semibold tracking-tight text-slate-950">
        {value}
      </p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function PostureRow({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
      <div className="flex items-center gap-2">
        {ok ? (
          <ShieldCheck size={14} className="text-emerald-600" />
        ) : (
          <ShieldAlert size={14} className="text-amber-600" />
        )}
        <span className="text-xs font-medium text-slate-600">{label}</span>
      </div>
      <span className="text-xs font-semibold text-slate-900">{value}</span>
    </div>
  );
}
