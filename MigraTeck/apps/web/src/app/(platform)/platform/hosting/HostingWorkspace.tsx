"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ExternalLink,
  Globe2,
  Link2,
  Link2Off,
  Loader2,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
} from "lucide-react";

type HostingSnapshot = {
  organization: {
    id: string;
    name: string;
    slug: string;
    role: string;
  };
  binding: null | {
    nodeId: string;
    tenantId: string | null;
    externalId: string | null;
    displayName: string;
    status: string;
    metadata: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  };
  runtime: {
    configured: boolean;
    connected: boolean;
    latencyMs?: number;
    error?: string | null;
  };
  tenant: null | {
    id: string;
    name: string | null;
    slug: string | null;
    domain: string | null;
    status: string | null;
    tenant_type: string | null;
    company_name: string | null;
    updated_at: string | null;
  };
  metrics: {
    totalSites: number;
    activeSites: number;
    totalDomains: number;
    activeCertificates: number;
    expiringCertificates: number;
    recentDeployments: number;
    openProvisioningTasks: number;
  };
  websites: Array<{
    id: string;
    name: string | null;
    domain: string;
    hostingType: string;
    runtime: string;
    status: string;
    updatedAt: string;
  }>;
  domains: Array<{
    id: string;
    websiteId: string | null;
    domain: string;
    role: string;
    status: string;
    dnsProvider: string | null;
    autoRenew: boolean | null;
    expiresAt: string | null;
  }>;
  certificates: Array<{
    id: string;
    domainName: string;
    provider: string;
    status: string;
    autoRenew: boolean;
    issuedAt: string | null;
    expiresAt: string | null;
    nextRenewalAt: string | null;
  }>;
  deployments: Array<{
    id: string;
    name: string;
    type: string;
    status: string | null;
    createdAt: string | null;
    completedAt: string | null;
  }>;
  provisioningTasks: Array<{
    id: string;
    serviceInstanceId: string;
    type: string;
    status: string;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    errorText: string | null;
  }>;
  operationBoundary: {
    mode: string;
    consoleBaseUrl: string;
  };
};

type PanelTenant = {
  id: string;
  name: string | null;
  slug: string | null;
  domain: string | null;
  status: string | null;
  tenantType: string | null;
  companyName: string | null;
  websiteCount: number;
};

type TenantSearchPayload = {
  canManageBindings: boolean;
  tenants: PanelTenant[];
};

function statusClass(status: string | null | undefined) {
  const normalized = (status ?? "unknown").toLowerCase();
  if (["active", "healthy", "completed", "succeeded", "online"].includes(normalized)) {
    return "bg-emerald-50 text-emerald-700";
  }
  if (["queued", "running", "pending", "provisioning"].includes(normalized)) {
    return "bg-blue-50 text-blue-700";
  }
  if (["failed", "error", "expired", "suspended", "unhealthy"].includes(normalized)) {
    return "bg-rose-50 text-rose-700";
  }
  return "bg-slate-100 text-slate-600";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function daysUntil(value: string | null) {
  if (!value) return null;
  return Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
}

export function HostingWorkspace({ hostingEnabled }: { hostingEnabled: boolean }) {
  const [snapshot, setSnapshot] = useState<HostingSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [linking, setLinking] = useState(false);
  const [tenantQuery, setTenantQuery] = useState("");
  const [tenantResults, setTenantResults] = useState<PanelTenant[]>([]);
  const [tenantLoading, setTenantLoading] = useState(false);
  const [canManageBindings, setCanManageBindings] = useState<boolean | null>(null);
  const [bindingBusy, setBindingBusy] = useState(false);
  const [bindingError, setBindingError] = useState<string | null>(null);

  const load = useCallback(async (background = false) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/platform/hosting", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to load Hosting runtime");
      setSnapshot(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load Hosting runtime");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadTenants = useCallback(async (query = "") => {
    setTenantLoading(true);
    setBindingError(null);
    try {
      const params = new URLSearchParams({ limit: "40" });
      if (query.trim()) params.set("q", query.trim());
      const response = await fetch(
        "/api/platform/hosting/tenants?" + params.toString(),
        { cache: "no-store" },
      );
      const body = await response.json();
      if (response.status === 403) {
        setCanManageBindings(false);
        setTenantResults([]);
        return;
      }
      if (!response.ok) throw new Error(body.error ?? "Unable to load MigraPanel tenants");
      const payload = body as TenantSearchPayload;
      setCanManageBindings(payload.canManageBindings);
      setTenantResults(payload.tenants ?? []);
    } catch (err) {
      setBindingError(err instanceof Error ? err.message : "Unable to load MigraPanel tenants");
    } finally {
      setTenantLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!linking || canManageBindings === false) return;
    const timer = window.setTimeout(() => {
      void loadTenants(tenantQuery);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [linking, tenantQuery, canManageBindings, loadTenants]);

  const expiringCertificates = useMemo(
    () =>
      snapshot?.certificates.filter((certificate) => {
        const days = daysUntil(certificate.expiresAt);
        return days !== null && days >= 0 && days <= 30;
      }) ?? [],
    [snapshot],
  );

  async function openLinker() {
    setLinking(true);
    if (canManageBindings === null) await loadTenants("");
  }

  async function bindTenant(tenant: PanelTenant) {
    if (
      !window.confirm(
        "Link " +
          (tenant.name ?? tenant.companyName ?? tenant.id) +
          " to this MigraTeck organization? This controls which hosting inventory the organization can see.",
      )
    ) {
      return;
    }

    setBindingBusy(true);
    setBindingError(null);
    try {
      const response = await fetch("/api/platform/hosting/binding", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: tenant.id }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to link MigraPanel tenant");
      setLinking(false);
      setTenantQuery("");
      await load(true);
    } catch (err) {
      setBindingError(err instanceof Error ? err.message : "Unable to link MigraPanel tenant");
    } finally {
      setBindingBusy(false);
    }
  }

  async function unbindTenant() {
    if (
      !window.confirm(
        "Unlink this MigraPanel tenant? Hosting data will disappear from this organization until a tenant is linked again. MigraPanel data itself will not be deleted.",
      )
    ) {
      return;
    }

    setBindingBusy(true);
    setBindingError(null);
    try {
      const response = await fetch("/api/platform/hosting/binding", {
        method: "DELETE",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to unlink MigraPanel tenant");
      await load(true);
    } catch (err) {
      setBindingError(err instanceof Error ? err.message : "Unable to unlink MigraPanel tenant");
    } finally {
      setBindingBusy(false);
    }
  }

  if (loading && !snapshot) {
    return (
      <div className="grid min-h-72 place-items-center rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 text-sm font-medium text-slate-600">
          <Loader2 size={18} className="animate-spin text-blue-600" />
          Loading MigraHosting runtime…
        </div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <section className="rounded-3xl border border-rose-200 bg-rose-50 p-6">
        <h2 className="font-semibold text-rose-950">Hosting runtime unavailable</h2>
        <p className="mt-2 text-sm leading-6 text-rose-800">
          {error ?? "No Hosting runtime context is available."}
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

  const baseUrl = snapshot.operationBoundary.consoleBaseUrl.replace(/\/$/, "");

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
          {error}
        </div>
      ) : null}

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={
                  "rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] " +
                  (snapshot.runtime.connected
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-rose-50 text-rose-700")
                }
              >
                {snapshot.runtime.connected ? "Runtime connected" : "Runtime unavailable"}
              </span>
              <span
                className={
                  "rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] " +
                  (snapshot.binding ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700")
                }
              >
                {snapshot.binding ? "Tenant linked" : "Tenant not linked"}
              </span>
            </div>
            <h2 className="mt-3 text-xl font-semibold tracking-tight text-slate-950">
              {snapshot.tenant?.name ??
                snapshot.binding?.displayName ??
                snapshot.organization.name + " Hosting"}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              MigraTeck owns identity, commercial access, trust, and the cross-system binding.
              MigraPanel remains the runtime authority for websites, domains, SSL, deployments, and
              provisioning operations.
            </p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
              <span>Org: {snapshot.organization.slug}</span>
              {snapshot.tenant?.slug ? <span>Tenant: {snapshot.tenant.slug}</span> : null}
              {snapshot.runtime.latencyMs !== undefined ? (
                <span>DB signal: {snapshot.runtime.latencyMs} ms</span>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              onClick={() => void load(true)}
              disabled={refreshing}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
              Refresh
            </button>
            <a
              href={baseUrl + "/console/hosting"}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Open MigraPanel <ExternalLink size={14} />
            </a>
          </div>
        </div>
      </section>

      {!hostingEnabled ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-700" />
            <div>
              <h3 className="text-sm font-semibold text-amber-950">Commercial access is not enabled</h3>
              <p className="mt-1 text-sm leading-6 text-amber-800">
                Runtime visibility is independent from billing state, but new Hosting provisioning
                should remain blocked until the organization has an active Hosting entitlement.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {!snapshot.binding ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-amber-50 text-amber-700">
              <Link2Off size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-slate-950">No MigraPanel tenant is linked</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                The Platform will not guess this relationship from names or domains. A platform
                owner must explicitly bind the organization to the authoritative MigraPanel tenant
                before any Hosting inventory is exposed.
              </p>
              <button
                onClick={() => void openLinker()}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
              >
                <Link2 size={15} /> Link MigraPanel tenant
              </button>
            </div>
          </div>

          {linking ? (
            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
              {canManageBindings === false ? (
                <p className="text-sm leading-6 text-slate-600">
                  This control requires MigraTeck platform-owner authority. The current user can
                  view Hosting but cannot change cross-system tenant bindings.
                </p>
              ) : (
                <>
                  <div className="relative">
                    <Search
                      size={16}
                      className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                    />
                    <input
                      value={tenantQuery}
                      onChange={(event) => setTenantQuery(event.target.value)}
                      placeholder="Search MigraPanel tenant, company, slug, or domain…"
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-10 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                    />
                    {tenantLoading ? (
                      <Loader2
                        size={15}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-slate-400"
                      />
                    ) : null}
                  </div>
                  {bindingError ? (
                    <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                      {bindingError}
                    </div>
                  ) : null}
                  <div className="mt-3 max-h-80 divide-y divide-slate-200 overflow-y-auto rounded-xl border border-slate-200 bg-white">
                    {tenantResults.map((tenant) => (
                      <button
                        key={tenant.id}
                        onClick={() => void bindTenant(tenant)}
                        disabled={bindingBusy}
                        className="flex w-full items-start justify-between gap-4 p-4 text-left transition hover:bg-blue-50 disabled:opacity-50"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            {tenant.name ?? tenant.companyName ?? tenant.id}
                          </p>
                          <p className="mt-1 truncate text-xs text-slate-500">
                            {[tenant.slug, tenant.domain, tenant.tenantType].filter(Boolean).join(" · ") || tenant.id}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <span className={"rounded-full px-2 py-0.5 text-[10px] font-semibold " + statusClass(tenant.status)}>
                            {tenant.status ?? "unknown"}
                          </span>
                          <p className="mt-1 text-[10px] text-slate-400">{tenant.websiteCount} sites</p>
                        </div>
                      </button>
                    ))}
                    {!tenantLoading && tenantResults.length === 0 ? (
                      <p className="p-4 text-sm text-slate-500">No MigraPanel tenants match this search.</p>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          ) : null}
        </section>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              icon={<Server size={18} />}
              label="Websites"
              value={snapshot.metrics.activeSites + " / " + snapshot.metrics.totalSites}
              detail="active / total"
            />
            <MetricCard
              icon={<Globe2 size={18} />}
              label="Domains"
              value={snapshot.metrics.totalDomains.toString()}
              detail="attached to this tenant"
            />
            <MetricCard
              icon={<ShieldCheck size={18} />}
              label="SSL"
              value={snapshot.metrics.activeCertificates.toString()}
              detail={
                snapshot.metrics.expiringCertificates
                  ? snapshot.metrics.expiringCertificates + " expiring within 30 days"
                  : "no certificates expiring soon"
              }
            />
            <MetricCard
              icon={<Activity size={18} />}
              label="Open tasks"
              value={snapshot.metrics.openProvisioningTasks.toString()}
              detail={snapshot.metrics.recentDeployments + " deployments in 7 days"}
            />
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
                  Live workload inventory
                </p>
                <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">Websites</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Read from the authoritative MigraPanel tenant. Runtime changes remain in MigraPanel.
                </p>
              </div>
              <a
                href={baseUrl + "/console/hosting"}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 text-sm font-semibold text-blue-600 hover:text-blue-700"
              >
                Manage all in MigraPanel <ExternalLink size={14} />
              </a>
            </div>

            {snapshot.websites.length === 0 ? (
              <div className="grid min-h-40 place-items-center p-8 text-center text-sm text-slate-500">
                No websites are attached to this MigraPanel tenant.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {snapshot.websites.map((site) => (
                  <article key={site.id} className="p-5 sm:px-6">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-semibold text-slate-950">
                            {site.name || site.domain}
                          </h3>
                          <span className={"rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] " + statusClass(site.status)}>
                            {site.status}
                          </span>
                        </div>
                        <p className="mt-1 truncate font-mono text-xs text-slate-600">{site.domain}</p>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                          <span>{site.hostingType}</span>
                          <span>{site.runtime}</span>
                          <span>Updated {formatDate(site.updatedAt)}</span>
                        </div>
                      </div>
                      <a
                        href={baseUrl + "/console/hosting/" + encodeURIComponent(site.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Operate <ExternalLink size={13} />
                      </a>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <div className="grid gap-6 xl:grid-cols-2">
            <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">Domain & certificate posture</p>
                <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">SSL attention</h2>
              </div>
              {expiringCertificates.length === 0 ? (
                <div className="flex min-h-40 items-center gap-3 p-6 text-sm text-slate-600">
                  <CheckCircle2 size={19} className="text-emerald-600" />
                  No certificate expires within the next 30 days.
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {expiringCertificates.map((certificate) => {
                    const days = daysUntil(certificate.expiresAt);
                    return (
                      <div key={certificate.id} className="p-5 sm:px-6">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-mono text-xs font-semibold text-slate-800">
                              {certificate.domainName}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {certificate.provider} · auto-renew {certificate.autoRenew ? "on" : "off"}
                            </p>
                          </div>
                          <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                            {days}d
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">Provisioning evidence</p>
                <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">Open tasks</h2>
              </div>
              {snapshot.provisioningTasks.length === 0 ? (
                <div className="flex min-h-40 items-center gap-3 p-6 text-sm text-slate-600">
                  <CheckCircle2 size={19} className="text-emerald-600" />
                  No Hosting provisioning tasks are currently open.
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {snapshot.provisioningTasks.map((task) => (
                    <div key={task.id} className="p-5 sm:px-6">
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="text-xs font-semibold text-slate-800">{task.type}</code>
                        <span className={"rounded-full px-2 py-0.5 text-[10px] font-bold " + statusClass(task.status)}>
                          {task.status}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        Queued {formatDate(task.createdAt)}
                      </p>
                      {task.errorText ? (
                        <p className="mt-2 rounded-lg bg-rose-50 px-2.5 py-2 text-xs leading-5 text-rose-700">
                          {task.errorText}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Cross-system identity
                </p>
                <h2 className="mt-1 text-base font-semibold text-slate-950">MigraPanel tenant binding</h2>
                <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                  <p>
                    <span className="font-semibold text-slate-700">Resource node:</span>{" "}
                    <code>{snapshot.binding.nodeId}</code>
                  </p>
                  <p>
                    <span className="font-semibold text-slate-700">Tenant ID:</span>{" "}
                    <code>{snapshot.binding.tenantId ?? "unknown"}</code>
                  </p>
                  <p>
                    <span className="font-semibold text-slate-700">Status:</span>{" "}
                    {snapshot.binding.status}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-700">Updated:</span>{" "}
                    {formatDate(snapshot.binding.updatedAt)}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  onClick={() => void openLinker()}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Link2 size={14} /> Change linkage
                </button>
                {canManageBindings ? (
                  <button
                    onClick={() => void unbindTenant()}
                    disabled={bindingBusy}
                    className="inline-flex items-center gap-2 rounded-xl border border-rose-200 px-3.5 py-2.5 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                  >
                    <Link2Off size={14} /> Unlink
                  </button>
                ) : null}
              </div>
            </div>

            {linking ? (
              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                {canManageBindings === false ? (
                  <p className="text-sm leading-6 text-slate-600">
                    Changing tenant linkage requires MigraTeck platform-owner authority.
                  </p>
                ) : (
                  <>
                    <div className="relative">
                      <Search
                        size={16}
                        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                      />
                      <input
                        value={tenantQuery}
                        onChange={(event) => setTenantQuery(event.target.value)}
                        placeholder="Search a replacement MigraPanel tenant…"
                        className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-10 text-sm text-slate-800 outline-none focus:border-blue-400"
                      />
                      {tenantLoading ? (
                        <Loader2
                          size={15}
                          className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-slate-400"
                        />
                      ) : null}
                    </div>
                    <div className="mt-3 max-h-72 divide-y divide-slate-200 overflow-y-auto rounded-xl border border-slate-200 bg-white">
                      {tenantResults.map((tenant) => (
                        <button
                          key={tenant.id}
                          onClick={() => void bindTenant(tenant)}
                          disabled={bindingBusy}
                          className="flex w-full items-center justify-between gap-4 p-3 text-left hover:bg-blue-50 disabled:opacity-50"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">
                              {tenant.name ?? tenant.companyName ?? tenant.id}
                            </p>
                            <p className="mt-1 truncate text-xs text-slate-500">
                              {[tenant.slug, tenant.domain].filter(Boolean).join(" · ") || tenant.id}
                            </p>
                          </div>
                          <span className="shrink-0 text-xs text-slate-500">{tenant.websiteCount} sites</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </section>
        </>
      )}
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
