"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Link2,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  X,
  XCircle,
} from "lucide-react";

export type RuntimeReconstructionContext = {
  generatedAt: string;
  authority: {
    canManageBindings: boolean;
    canManageEntitlements: boolean;
  };
  organization: {
    id: string;
    name: string;
    slug: string;
    isMigraHostingClient: boolean;
  };
  entitlement: {
    id: string;
    status: string;
    notes: string | null;
    startsAt: string | null;
    endsAt: string | null;
    updatedAt: string;
    activeLike: boolean;
  } | null;
  hostingRuntime: {
    configured: boolean;
    connected: boolean;
    latencyMs?: number;
    error?: string | null;
  };
  binding: {
    nodeId: string;
    tenantId: string | null;
    displayName: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  } | null;
  candidates: Array<{
    tenantId: string;
    name: string | null;
    slug: string | null;
    companyName: string | null;
    status: string | null;
    matchScore: number;
    matchReason: string;
    domains: string[];
    serviceInstances: Array<{ id: string; status: string }>;
    targetIps: string[];
    suggestedContext: Record<string, string>;
  }>;
  provenance: Array<{
    source: string | null;
    tenantId: string | null;
    monthlyRevenue: number | null;
    createdAt: string;
  }>;
  historicalTenants: Array<{
    tenantId: string;
    state: "available" | "missing" | "unavailable";
    candidate: {
      tenantId: string;
      name: string | null;
      slug: string | null;
      companyName: string | null;
      status: string | null;
    } | null;
  }>;
  jobs: Array<{
    id: string;
    action: string | null;
    lastError: string | null;
    createdAt: string;
    updatedAt: string;
    malformed: boolean;
    payloadHashValid: boolean;
    signatureValid: boolean;
    recoveryContractAvailable: boolean;
    readyToRetry: boolean;
    retryReason: string | null;
    requiredFields: string[];
    missingFields: string[];
    currentContext: Record<string, string>;
  }>;
  diagnosis: {
    state:
      | "runtime_linked"
      | "existing_tenant_candidate"
      | "runtime_reconstruction_required"
      | "hosting_runtime_unavailable"
      | "no_active_entitlement";
    recommendedAction: string;
    explanation: string;
    currentBinding: boolean;
    candidateCount: number;
    historicalTenantCount: number;
    availableHistoricalTenants: number;
    missingHistoricalTenants: number;
    deadJobs: number;
    malformedJobs: number;
    readyToRetryJobs: number;
    missingContext: string[];
    legacyReplayBlocked: boolean;
  };
  safety: {
    readOnly: boolean;
    noAutomaticBinding: boolean;
    noAutomaticTenantCreation: boolean;
    noAutomaticEntitlementChange: boolean;
    noAutomaticReplay: boolean;
  };
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function diagnosisLabel(
  state: RuntimeReconstructionContext["diagnosis"]["state"],
) {
  switch (state) {
    case "runtime_linked":
      return "Runtime linked";
    case "existing_tenant_candidate":
      return "Tenant candidate found";
    case "runtime_reconstruction_required":
      return "Runtime reconstruction required";
    case "hosting_runtime_unavailable":
      return "Hosting runtime unavailable";
    case "no_active_entitlement":
      return "No active entitlement";
  }
}

function diagnosisClasses(
  state: RuntimeReconstructionContext["diagnosis"]["state"],
) {
  if (state === "runtime_linked") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (state === "existing_tenant_candidate") {
    return "border-cyan-200 bg-cyan-50 text-cyan-800";
  }
  if (state === "runtime_reconstruction_required") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }
  return "border-rose-200 bg-rose-50 text-rose-800";
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
        {value}
      </p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
    </div>
  );
}

export function RuntimeReconstructionPanel({
  context,
  consoleBaseUrl,
  platformBaseUrl,
  onClose,
  onInspectAccess,
  onOpenDeadLetter,
}: {
  context: RuntimeReconstructionContext;
  consoleBaseUrl: string;
  platformBaseUrl: string;
  onClose: () => void;
  onInspectAccess: () => void;
  onOpenDeadLetter: (jobId: string) => void;
}) {
  const primaryJob = context.jobs[0] ?? null;
  const createTenantParams = new URLSearchParams({
    source: "platform",
    name: context.organization.name,
    companyName: context.organization.name,
    returnTo: platformBaseUrl.replace(/\/$/, "") + "/platform/commerce/catalog",
    handoffOrgId: context.organization.id,
    ...(primaryJob ? { handoffJobId: primaryJob.id } : {}),
  });
  const createTenantUrl =
    consoleBaseUrl.replace(/\/$/, "") +
    "/console/clients/new?" +
    createTenantParams.toString();

  return (
    <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-5 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-amber-50 text-amber-700">
            <ServerCog size={20} />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
              Hosting runtime reconstruction
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight text-slate-950">
                {context.organization.name}
              </h2>
              <span
                className={
                  "rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] " +
                  diagnosisClasses(context.diagnosis.state)
                }
              >
                {diagnosisLabel(context.diagnosis.state)}
              </span>
            </div>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              {context.diagnosis.explanation}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-50"
          aria-label="Close runtime reconstruction"
        >
          <X size={16} />
        </button>
      </div>

      <div className="grid gap-3 border-b border-slate-100 p-5 sm:grid-cols-2 sm:p-6 xl:grid-cols-6">
        <Metric
          label="MigraPanel"
          value={context.hostingRuntime.connected ? "Live" : "Unavailable"}
          detail={
            context.hostingRuntime.connected
              ? "hosting data source reachable"
              : "runtime evidence cannot be verified"
          }
        />
        <Metric
          label="Current binding"
          value={context.binding?.tenantId ? "Linked" : "None"}
          detail={
            context.binding?.displayName ??
            "no current MigraHosting ResourceNode tenant"
          }
        />
        <Metric
          label="Candidates"
          value={context.diagnosis.candidateCount}
          detail="live MigraPanel tenant matches"
        />
        <Metric
          label="Dead jobs"
          value={context.diagnosis.deadJobs}
          detail="historical MigraHosting evidence"
        />
        <Metric
          label="Malformed"
          value={context.diagnosis.malformedJobs}
          detail="legacy jobs blocked from replay"
        />
        <Metric
          label="Retry ready"
          value={context.diagnosis.readyToRetryJobs}
          detail="jobs with complete current context"
        />
      </div>

      <div className="grid gap-5 p-5 sm:p-6 2xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-start gap-3">
              {context.diagnosis.legacyReplayBlocked ? (
                <XCircle size={18} className="mt-0.5 shrink-0 text-rose-600" />
              ) : (
                <ShieldCheck
                  size={18}
                  className="mt-0.5 shrink-0 text-emerald-600"
                />
              )}
              <div>
                <p className="text-sm font-semibold text-slate-950">
                  Legacy replay boundary
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  {context.diagnosis.legacyReplayBlocked
                    ? "At least one historical job is explicitly malformed. Those jobs cannot be replayed; recovery must use a fresh signed entitlement reconciliation."
                    : context.diagnosis.readyToRetryJobs > 0
                      ? "A legacy job has valid source evidence and complete current context. Retry still remains an explicit operator action."
                      : "Historical jobs verify, but required runtime context is incomplete. Retry remains blocked until current hosting evidence exists."}
                </p>
              </div>
            </div>

            {context.diagnosis.missingContext.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {context.diagnosis.missingContext.map((field) => (
                  <span
                    key={field}
                    className="rounded-lg border border-amber-200 bg-white px-2 py-1 text-[10px] font-semibold text-amber-800"
                  >
                    missing {field}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Historical jobs
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Safe replay evidence only. Raw job payloads and secrets are
                  not exposed.
                </p>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {context.jobs.map((job) => (
                <article
                  key={job.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900">
                          {job.action ?? "Unknown action"}
                        </span>
                        <span
                          className={
                            "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] " +
                            (job.malformed
                              ? "bg-rose-50 text-rose-700"
                              : job.readyToRetry
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-amber-50 text-amber-700")
                          }
                        >
                          {job.malformed
                            ? "Malformed"
                            : job.readyToRetry
                              ? "Retry ready"
                              : "Context required"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        {job.retryReason ??
                          job.lastError ??
                          "No terminal reason recorded."}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {job.missingFields.map((field) => (
                          <span
                            key={field}
                            className="rounded-md bg-slate-100 px-2 py-1 text-[9px] font-semibold text-slate-600"
                          >
                            {field}
                          </span>
                        ))}
                      </div>
                      <p className="mt-2 font-mono text-[10px] text-slate-400">
                        {job.id}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenDeadLetter(job.id)}
                      className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      Review job <ExternalLink size={12} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {context.historicalTenants.length > 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Historical tenant evidence
              </p>
              <div className="mt-3 space-y-2">
                {context.historicalTenants.map((tenant) => (
                  <div
                    key={tenant.tenantId}
                    className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2"
                  >
                    <code className="min-w-0 truncate text-[10px] text-slate-600">
                      {tenant.tenantId}
                    </code>
                    <span
                      className={
                        "shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] " +
                        (tenant.state === "available"
                          ? "bg-emerald-50 text-emerald-700"
                          : tenant.state === "missing"
                            ? "bg-rose-50 text-rose-700"
                            : "bg-amber-50 text-amber-700")
                      }
                    >
                      {tenant.state}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {context.candidates.length > 0 ? (
            <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-700">
                Existing tenant candidates
              </p>
              <div className="mt-3 space-y-2">
                {context.candidates.map((candidate) => (
                  <div
                    key={candidate.tenantId}
                    className="rounded-xl border border-cyan-100 bg-white p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {candidate.name ??
                            candidate.companyName ??
                            candidate.slug ??
                            candidate.tenantId}
                        </p>
                        <p className="mt-1 text-[10px] text-slate-500">
                          Match {candidate.matchScore}% ·{" "}
                          {candidate.matchReason}
                        </p>
                      </div>
                      <a
                        href={
                          consoleBaseUrl.replace(/\/$/, "") +
                          "/console/clients/" +
                          encodeURIComponent(candidate.tenantId)
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-cyan-700"
                      >
                        Open <ExternalLink size={11} />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div
            className={
              "rounded-2xl border p-4 " +
              (context.diagnosis.state === "runtime_reconstruction_required"
                ? "border-amber-200 bg-amber-50"
                : "border-slate-200 bg-slate-50")
            }
          >
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              Recommended next action
            </p>
            <p className="mt-2 text-sm font-semibold text-slate-950">
              {context.diagnosis.recommendedAction
                .split("_")
                .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                .join(" ")}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {context.diagnosis.state === "runtime_reconstruction_required" &&
              primaryJob ? (
                <a
                  href={createTenantUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-700 px-3.5 py-2.5 text-xs font-semibold text-white transition hover:bg-amber-800"
                >
                  <ServerCog size={13} /> Create current MigraPanel tenant
                </a>
              ) : null}

              <button
                type="button"
                onClick={onInspectAccess}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <Link2 size={13} /> Inspect organization access
              </button>

              <a
                href="/platform/hosting"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Open Hosting <ExternalLink size={12} />
              </a>
            </div>

            {!context.authority.canManageBindings ? (
              <p className="mt-3 text-[11px] leading-5 text-slate-500">
                Binding requires platform.hosting.bindings.manage. This
                diagnostic remains read-only.
              </p>
            ) : null}
          </div>

          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2
                size={17}
                className="mt-0.5 shrink-0 text-emerald-700"
              />
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-800">
                  Control-plane guardrail
                </p>
                <p className="mt-1 text-xs leading-5 text-emerald-800/80">
                  This diagnosis never creates tenants, binds organizations,
                  changes entitlements, or retries provisioning automatically.
                  Every recovery mutation remains a separate audited operator
                  action.
                </p>
              </div>
            </div>
          </div>

          {!context.hostingRuntime.connected ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs leading-5 text-rose-800">
              <div className="flex items-start gap-2">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                MigraPanel runtime evidence is unavailable. Do not create or
                bind recovery state until the data source is healthy.
              </div>
            </div>
          ) : null}

          <p className="flex items-center gap-2 text-[10px] text-slate-400">
            <RefreshCw size={11} /> Evidence generated{" "}
            {formatDate(context.generatedAt)}
          </p>
        </div>
      </div>
    </section>
  );
}
