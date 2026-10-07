"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  FileCheck2,
  Loader2,
  PackageCheck,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Search,
  ServerCog,
  ShieldCheck,
  X,
} from "lucide-react";

type ProductKey =
  | "MIGRATECK"
  | "MIGRAHOSTING"
  | "MIGRAPANEL"
  | "MIGRAVOICE"
  | "MIGRAMAIL"
  | "MIGRAINTAKE"
  | "MIGRAMARKET"
  | "MIGRAPILOT"
  | "MIGRAINVOICE"
  | "MIGRADRIVE"
  | "MIGRABUILDER";

type DistributionArtifact = {
  id: string;
  name: string;
  product: ProductKey;
  version: string;
  fileKey: string;
  sha256: string;
  sizeBytes: string;
  isActive: boolean;
  createdAt: string;
  lastAuditAction: string | null;
  lastAuditMetadata: Record<string, unknown> | null;
  lastAuditAt: string | null;
};

type DistributionActivity = {
  id: string;
  action: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

type DistributionPayload = {
  authority: {
    roles: string[];
    canVerify: boolean;
    canManage: boolean;
    viaBootstrap: boolean;
  };
  storage: {
    configured: boolean;
    provider: "s3" | "minio" | "mock" | null;
    endpointHost: string | null;
    bucket: string | null;
    region: string;
    ttlSeconds: number;
    resolvedAddresses: string[];
    internalRoute: boolean;
    verifyMaxBytes: number;
    verifyTimeoutMs: number;
  };
  metrics: {
    artifacts: number;
    activeArtifacts: number;
    inactiveArtifacts: number;
    activeBytes: string;
    products: number;
  };
  artifacts: DistributionArtifact[];
  activity: DistributionActivity[];
};

type RegisterForm = {
  name: string;
  product: ProductKey;
  version: string;
  fileKey: string;
};

type TransitionState = {
  artifact: DistributionArtifact;
  action: "activate" | "deactivate";
  reason: string;
};

const PRODUCT_KEYS: ProductKey[] = [
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

const EMPTY_FORM: RegisterForm = {
  name: "",
  product: "MIGRAINVOICE",
  version: "",
  fileKey: "",
};

function formatBytes(value: string | number) {
  const bytes = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = bytes;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return (index === 0 ? amount.toFixed(0) : amount.toFixed(amount >= 10 ? 1 : 2)) + " " + units[index];
}

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function actionLabel(action: string | null) {
  if (!action) return "No audit evidence";
  return action
    .replace(/^DOWNLOAD_ARTIFACT_/, "")
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function auditTone(action: string | null) {
  if (!action) return "bg-slate-100 text-slate-600";
  if (action.includes("FAILED") || action.includes("BLOCKED")) return "bg-rose-50 text-rose-700";
  if (action.includes("DEACTIVATED")) return "bg-amber-50 text-amber-700";
  if (action.includes("VERIFIED") || action.includes("ACTIVATED")) return "bg-emerald-50 text-emerald-700";
  return "bg-blue-50 text-blue-700";
}

export function DistributionWorkspace() {
  const [data, setData] = useState<DistributionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [form, setForm] = useState<RegisterForm>(EMPTY_FORM);
  const [registering, setRegistering] = useState(false);
  const [busyArtifact, setBusyArtifact] = useState<string | null>(null);
  const [transition, setTransition] = useState<TransitionState | null>(null);
  const [transitioning, setTransitioning] = useState(false);

  const load = useCallback(async (background = false) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/platform/distribution/artifacts", {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? body.message ?? "Unable to load release distribution");
      }
      setData(body);
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : "Unable to load release distribution");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredArtifacts = useMemo(() => {
    if (!data) return [];
    const normalized = query.trim().toLowerCase();

    return data.artifacts.filter((artifact) => {
      if (statusFilter === "active" && !artifact.isActive) return false;
      if (statusFilter === "inactive" && artifact.isActive) return false;
      if (!normalized) return true;
      return [
        artifact.name,
        artifact.product,
        artifact.version,
        artifact.fileKey,
        artifact.sha256,
      ].some((value) => value.toLowerCase().includes(normalized));
    });
  }, [data, query, statusFilter]);

  async function registerArtifact() {
    if (!form.name.trim() || !form.version.trim() || !form.fileKey.trim()) {
      setError("Name, version, and object key are required.");
      return;
    }

    setRegistering(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/platform/distribution/artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          product: form.product,
          version: form.version.trim(),
          fileKey: form.fileKey.trim(),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to register artifact");

      setForm(EMPTY_FORM);
      setNotice(
        "Artifact registered inactive after object-store checksum and byte-size verification.",
      );
      await load(true);
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : "Unable to register artifact");
    } finally {
      setRegistering(false);
    }
  }

  async function verifyArtifact(artifact: DistributionArtifact) {
    setBusyArtifact(artifact.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        "/api/platform/distribution/artifacts/" + encodeURIComponent(artifact.id) + "/verify",
        { method: "POST" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Integrity verification failed");

      if (body.verified) {
        setNotice(
          artifact.name +
            " verified: SHA-256 and byte count match the registered release metadata.",
        );
      } else {
        setError(
          artifact.name +
            " does not match the registered release metadata. Activation should remain blocked.",
        );
      }
      await load(true);
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : "Integrity verification failed");
    } finally {
      setBusyArtifact(null);
    }
  }

  async function submitTransition() {
    if (!transition || transition.reason.trim().length < 3) {
      setError("A release-state reason of at least 3 characters is required.");
      return;
    }

    setTransitioning(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        "/api/platform/distribution/artifacts/" +
          encodeURIComponent(transition.artifact.id) +
          "/" +
          transition.action,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: transition.reason.trim() }),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(
          body.error ??
            ("Unable to " + transition.action + " the selected release"),
        );
      }

      setNotice(
        transition.artifact.name +
          (transition.action === "activate"
            ? " is now active after checksum re-verification."
            : " has been deactivated. Historical release evidence was retained."),
      );
      setTransition(null);
      await load(true);
    } catch (candidate) {
      setError(
        candidate instanceof Error
          ? candidate.message
          : "Unable to change release state",
      );
    } finally {
      setTransitioning(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="grid min-h-72 place-items-center rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 text-sm font-medium text-slate-600">
          <Loader2 size={18} className="animate-spin text-blue-600" />
          Loading release authority…
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <section className="rounded-3xl border border-rose-200 bg-rose-50 p-6">
        <h2 className="font-semibold text-rose-950">Release distribution unavailable</h2>
        <p className="mt-2 text-sm leading-6 text-rose-800">
          {error ?? "MigraTeck platform release authority is required."}
        </p>
        <button
          onClick={() => void load()}
          className="mt-4 inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-800"
        >
          <RefreshCw size={15} /> Retry
        </button>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {data.authority.viaBootstrap ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This operator session is using bootstrap platform authority. Persistent MigraAuth role grants are preferred for release operations.
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
        <Metric label="Active releases" value={data.metrics.activeArtifacts.toLocaleString()} detail={data.metrics.products + " product lanes"} />
        <Metric label="Inactive releases" value={data.metrics.inactiveArtifacts.toLocaleString()} detail="retained but not downloadable" />
        <Metric label="Published bytes" value={formatBytes(data.metrics.activeBytes)} detail="active artifact footprint" />
        <Metric label="Signed URL TTL" value={data.storage.ttlSeconds + " sec"} detail="customer delivery lifetime" />
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <article className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">
              Object storage
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
              Distribution route readiness
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              The signer keeps the public S3 hostname in SigV4 while server-side DNS routes internally to the edge proxy.
            </p>
          </div>
          <div className="space-y-4 p-5 sm:p-6">
            <div className={"rounded-2xl border p-4 " + (data.storage.configured && data.storage.internalRoute ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50")}>
              <div className="flex items-start gap-3">
                <span className={"grid h-9 w-9 shrink-0 place-items-center rounded-xl " + (data.storage.configured && data.storage.internalRoute ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>
                  {data.storage.configured && data.storage.internalRoute ? <ShieldCheck size={16} /> : <AlertTriangle size={16} />}
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-950">
                    {data.storage.configured ? "Signer configured" : "Signer incomplete"}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-600">
                    {data.storage.internalRoute
                      ? "The public storage hostname currently resolves through an internal/private address from the Platform API host."
                      : "The storage hostname is not currently resolving through an internal/private route."}
                  </p>
                </div>
              </div>
            </div>

            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <StorageField label="Provider" value={data.storage.provider ?? "Not configured"} />
              <StorageField label="Endpoint" value={data.storage.endpointHost ?? "Not configured"} mono />
              <StorageField label="Bucket" value={data.storage.bucket ?? "Not configured"} mono />
              <StorageField label="Region" value={data.storage.region} />
              <StorageField
                label="Resolved route"
                value={data.storage.resolvedAddresses.join(", ") || "No DNS result"}
                mono
              />
              <StorageField
                label="Verify ceiling"
                value={formatBytes(data.storage.verifyMaxBytes)}
              />
            </dl>
          </div>
        </article>

        <article className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
              Register release
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
              Add an object-store artifact
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Registration streams the existing object, derives SHA-256 and size, and creates an inactive record. It does not upload or overwrite files.
            </p>
          </div>

          {data.authority.canManage ? (
            <div className="space-y-4 p-5 sm:p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Display name">
                  <input
                    value={form.name}
                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                    placeholder="MigraInvoice Desktop (Windows Setup)"
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm text-slate-900 outline-none focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10"
                  />
                </Field>
                <Field label="Product">
                  <select
                    value={form.product}
                    onChange={(event) => setForm((current) => ({ ...current, product: event.target.value as ProductKey }))}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-blue-400"
                  >
                    {PRODUCT_KEYS.map((product) => (
                      <option key={product} value={product}>{product}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Version">
                <input
                  value={form.version}
                  onChange={(event) => setForm((current) => ({ ...current, version: event.target.value }))}
                  placeholder="1.0.1"
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 font-mono text-sm text-slate-900 outline-none focus:border-blue-400 focus:bg-white"
                />
              </Field>
              <Field label="Object key">
                <input
                  value={form.fileKey}
                  onChange={(event) => setForm((current) => ({ ...current, fileKey: event.target.value }))}
                  placeholder="migrainvoice/1.0.1/MigraInvoice-Setup-1.0.1.exe"
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 font-mono text-xs text-slate-900 outline-none focus:border-blue-400 focus:bg-white"
                />
              </Field>
              <button
                onClick={() => void registerArtifact()}
                disabled={registering}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-wait disabled:opacity-50"
              >
                {registering ? <Loader2 size={16} className="animate-spin" /> : <PackageCheck size={16} />}
                {registering ? "Hashing object and registering…" : "Verify & register inactive"}
              </button>
            </div>
          ) : (
            <div className="p-5 sm:p-6">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
                Read-only release access. MigraAuth <code className="font-semibold">platform.downloads.manage</code> authority is required to register or publish artifacts.
              </div>
            </div>
          )}
        </article>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Release inventory
              </p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
                Registered artifacts
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Integrity metadata is immutable. Active artifacts are eligible for entitlement-gated signed delivery.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative min-w-64">
                <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search release…"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-blue-400 focus:bg-white"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
                className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700"
              >
                <option value="all">All states</option>
                <option value="active">Active only</option>
                <option value="inactive">Inactive only</option>
              </select>
              <button
                onClick={() => void load(true)}
                disabled={refreshing}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
                Refresh
              </button>
            </div>
          </div>
        </div>

        {filteredArtifacts.length === 0 ? (
          <div className="grid min-h-48 place-items-center p-8 text-center">
            <div>
              <PackageCheck size={24} className="mx-auto text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-slate-900">No matching artifacts</p>
              <p className="mt-1 text-sm text-slate-500">Adjust the search or state filter.</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredArtifacts.map((artifact) => {
              const busy = busyArtifact === artifact.id;
              return (
                <article key={artifact.id} className="p-5 sm:p-6">
                  <div className="flex flex-col gap-5">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={"rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] " + (artifact.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600")}>
                            {artifact.isActive ? "Active" : "Inactive"}
                          </span>
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                            {artifact.product}
                          </span>
                          <code className="text-xs font-semibold text-slate-500">v{artifact.version}</code>
                        </div>
                        <h3 className="mt-2 text-base font-semibold text-slate-950">{artifact.name}</h3>
                        <code className="mt-2 block break-all text-[11px] leading-5 text-slate-500">{artifact.fileKey}</code>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {data.authority.canVerify ? (
                          <button
                            onClick={() => void verifyArtifact(artifact)}
                            disabled={busy}
                            className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 px-3.5 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-wait disabled:opacity-50"
                          >
                            {busy ? <Loader2 size={14} className="animate-spin" /> : <FileCheck2 size={14} />}
                            Verify bytes
                          </button>
                        ) : null}
                        {data.authority.canManage ? (
                          <button
                            onClick={() => setTransition({ artifact, action: artifact.isActive ? "deactivate" : "activate", reason: "" })}
                            className={"inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-semibold " + (artifact.isActive ? "border-amber-200 text-amber-700 hover:bg-amber-50" : "border-blue-200 text-blue-700 hover:bg-blue-50")}
                          >
                            {artifact.isActive ? <PauseCircle size={14} /> : <PlayCircle size={14} />}
                            {artifact.isActive ? "Deactivate" : "Activate"}
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 xl:grid-cols-4">
                      <ArtifactField label="Size" value={formatBytes(artifact.sizeBytes)} />
                      <ArtifactField label="Created" value={formatDate(artifact.createdAt)} />
                      <ArtifactField label="Last evidence" value={actionLabel(artifact.lastAuditAction)} />
                      <ArtifactField label="Evidence time" value={formatDate(artifact.lastAuditAt)} />
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-400">SHA-256</p>
                      <code className="mt-1 block break-all text-[11px] font-medium text-slate-700">{artifact.sha256}</code>
                    </div>

                    {artifact.lastAuditAction ? (
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span className={"rounded-full px-2 py-0.5 text-[9px] font-semibold " + auditTone(artifact.lastAuditAction)}>
                          {actionLabel(artifact.lastAuditAction)}
                        </span>
                        <span>{formatDate(artifact.lastAuditAt)}</span>
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Supply-chain evidence
          </p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
            Recent distribution activity
          </h2>
        </div>
        {data.activity.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">No distribution audit evidence has been recorded yet.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {data.activity.slice(0, 30).map((event) => (
              <div key={event.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div className="min-w-0">
                  <span className={"inline-block rounded-full px-2 py-0.5 text-[9px] font-semibold " + auditTone(event.action)}>
                    {actionLabel(event.action)}
                  </span>
                  <code className="ml-2 text-[10px] text-slate-400">{event.entityId ?? "distribution"}</code>
                </div>
                <span className="shrink-0 text-xs text-slate-500">{formatDate(event.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {transition ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                  Release state change
                </p>
                <h2 className="mt-1 text-lg font-semibold text-slate-950">
                  {transition.action === "activate" ? "Activate release" : "Deactivate release"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {transition.artifact.name} · {transition.artifact.product} · v{transition.artifact.version}
                </p>
              </div>
              <button
                onClick={() => setTransition(null)}
                disabled={transitioning}
                className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                aria-label="Close"
              >
                <X size={15} />
              </button>
            </div>

            {transition.action === "activate" ? (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs leading-5 text-emerald-800">
                Activation will stream and hash the object again. Any size or SHA-256 drift blocks publication.
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-800">
                Deactivation immediately removes this artifact from entitlement-gated download listings while retaining its metadata and audit history.
              </div>
            )}

            <label className="mt-4 block text-sm font-semibold text-slate-800">
              Operator reason
              <textarea
                value={transition.reason}
                onChange={(event) => setTransition((current) => current ? { ...current, reason: event.target.value } : current)}
                rows={3}
                maxLength={500}
                placeholder={transition.action === "activate" ? "Approved release after validation…" : "Withdrawn because…"}
                className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-900 outline-none focus:border-blue-400 focus:bg-white"
              />
            </label>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                onClick={() => setTransition(null)}
                disabled={transitioning}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void submitTransition()}
                disabled={transitioning || transition.reason.trim().length < 3}
                className={"inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 " + (transition.action === "activate" ? "bg-blue-600 hover:bg-blue-700" : "bg-amber-600 hover:bg-amber-700")}
              >
                {transitioning ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                {transitioning ? "Working…" : transition.action === "activate" ? "Verify & activate" : "Deactivate release"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
    </article>
  );
}

function StorageField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-400">{label}</dt>
      <dd className={"mt-1 break-all text-xs font-semibold text-slate-800 " + (mono ? "font-mono" : "")}>{value}</dd>
    </div>
  );
}

function ArtifactField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className="mt-1 text-xs font-semibold text-slate-800">{value}</p>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm font-semibold text-slate-800">
      {label}
      <div className="mt-2">{children}</div>
    </label>
  );
}
