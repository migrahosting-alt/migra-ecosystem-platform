"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Boxes,
  Building2,
  CheckCircle2,
  CreditCard,
  Database,
  FileInput,
  KeyRound,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Users,
  Webhook,
} from "lucide-react";

type IdentityOrganization = {
  id: string;
  name: string;
  slug: string;
  owner_user_id: string;
  owner: {
    id: string;
    email: string | null;
    display_name: string | null;
    status: string;
    last_login_at: string | null;
  };
  member_count: number;
  active_member_count: number;
  owner_count: number;
  oauth_client_count: number;
  created_at: string;
  updated_at: string;
};

type PlatformOrganization = {
  id: string;
  name: string;
  slug: string;
  authOrganizationId: string | null;
  isMigraHostingClient: boolean;
  createdAt: string;
  updatedAt: string;
};

type ClassificationState =
  | "LINKED"
  | "PLATFORM_ONLY_RUNTIME"
  | "PLATFORM_ONLY_EMPTY"
  | "STALE_LINK"
  | "AUTH_ONLY";

type DirectoryEntry = {
  kind: "PLATFORM" | "AUTH_ONLY";
  platform: PlatformOrganization | null;
  identity: IdentityOrganization | null;
  classification: {
    state: ClassificationState;
    needsReview: boolean;
    reason: string;
    footprint: number;
    drift: {
      name: boolean;
      slug: boolean;
      any: boolean;
    } | null;
  };
  footprint: {
    members: number;
    activeEntitlements: number;
    subscriptions: number;
    pendingProvisioning: number;
    failedProvisioning: number;
    activeApiKeys: number;
    activeWebhooks: number;
    intakeForms: number;
    hostingTenantExternalId: string | null;
  } | null;
};

type DirectoryPayload = {
  authority: {
    roles: string[];
    canManage: boolean;
    viaBootstrap: boolean;
  };
  entries: DirectoryEntry[];
  totals: {
    platform: number;
    identity: number;
    linked: number;
    platformOnlyRuntime: number;
    platformOnlyEmpty: number;
    staleLinks: number;
    authOnly: number;
    metadataDrift: number;
    needsReview: number;
  };
  limit: number;
  offset: number;
};

type Filter = "review" | "all" | "linked" | "platform-only" | "auth-only";

function entryKey(entry: DirectoryEntry): string {
  return entry.platform?.id ?? "auth:" + entry.identity!.id;
}

function stateLabel(state: ClassificationState): string {
  switch (state) {
    case "LINKED":
      return "Identity linked";
    case "PLATFORM_ONLY_RUNTIME":
      return "Platform runtime only";
    case "PLATFORM_ONLY_EMPTY":
      return "Empty legacy row";
    case "STALE_LINK":
      return "Stale identity link";
    case "AUTH_ONLY":
      return "Identity only";
  }
}

function stateClass(state: ClassificationState): string {
  switch (state) {
    case "LINKED":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "PLATFORM_ONLY_RUNTIME":
      return "bg-amber-50 text-amber-800 border-amber-200";
    case "PLATFORM_ONLY_EMPTY":
      return "bg-slate-100 text-slate-600 border-slate-200";
    case "STALE_LINK":
      return "bg-rose-50 text-rose-700 border-rose-200";
    case "AUTH_ONLY":
      return "bg-violet-50 text-violet-700 border-violet-200";
  }
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function footprintTotal(entry: DirectoryEntry): number {
  const f = entry.footprint;
  if (!f) return 0;
  return (
    f.members +
    f.activeEntitlements +
    f.subscriptions +
    f.pendingProvisioning +
    f.failedProvisioning +
    f.activeApiKeys +
    f.activeWebhooks +
    f.intakeForms +
    (f.hostingTenantExternalId ? 1 : 0)
  );
}

export function OrganizationOperatorWorkspace() {
  const [data, setData] = useState<DirectoryPayload | null>(null);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("review");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [linkIdentityId, setLinkIdentityId] = useState("");

  const load = useCallback(async (search: string, background = false) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ limit: "100", offset: "0" });
      if (search.trim()) params.set("q", search.trim());

      const response = await fetch(
        "/api/platform/organization-directory?" + params.toString(),
        { cache: "no-store" },
      );
      const body = await response.json().catch(() => null);

      if (response.status === 403) {
        setAuthorized(false);
        setData(null);
        return;
      }
      if (!response.ok) {
        throw new Error(body?.error ?? "Unable to load platform tenant directory");
      }

      setAuthorized(true);
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load platform tenant directory");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(query), 250);
    return () => window.clearTimeout(timer);
  }, [query, load]);

  const filteredEntries = useMemo(() => {
    if (!data) return [];
    return data.entries.filter((entry) => {
      if (filter === "all") return true;
      if (filter === "review") return entry.classification.needsReview;
      if (filter === "linked") return entry.classification.state === "LINKED";
      if (filter === "auth-only") return entry.classification.state === "AUTH_ONLY";
      return (
        entry.classification.state === "PLATFORM_ONLY_RUNTIME" ||
        entry.classification.state === "PLATFORM_ONLY_EMPTY" ||
        entry.classification.state === "STALE_LINK"
      );
    });
  }, [data, filter]);

  const selected = useMemo(() => {
    if (!data) return null;
    if (selectedKey) {
      const match = filteredEntries.find(
        (entry) => entryKey(entry) === selectedKey,
      );
      if (match) return match;
    }
    return filteredEntries[0] ?? data.entries[0] ?? null;
  }, [data, filteredEntries, selectedKey]);

  const availableIdentityOrganizations = useMemo(
    () =>
      data?.entries
        .filter((entry) => entry.kind === "AUTH_ONLY" && entry.identity)
        .map((entry) => entry.identity!) ?? [],
    [data],
  );

  useEffect(() => {
    if (!selected?.platform || selected.platform.authOrganizationId) {
      setLinkIdentityId("");
      return;
    }

    const exact = availableIdentityOrganizations.find(
      (identity) =>
        identity.slug.toLowerCase() === selected.platform!.slug.toLowerCase(),
    );
    setLinkIdentityId(exact?.id ?? "");
  }, [selected, availableIdentityOrganizations]);

  async function linkIdentity() {
    if (!selected?.platform || !linkIdentityId) return;
    setActionPending(true);
    setActionMessage(null);

    try {
      const response = await fetch(
        "/api/platform/organization-directory/" +
          encodeURIComponent(selected.platform.id) +
          "/link-identity",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ authOrganizationId: linkIdentityId }),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Unable to link organization identity");
      }
      setActionMessage("Identity organization linked and audited.");
      await load(query, true);
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Unable to link organization identity");
    } finally {
      setActionPending(false);
    }
  }

  async function syncIdentityMetadata() {
    if (!selected?.platform || !selected.identity) return;
    setActionPending(true);
    setActionMessage(null);

    try {
      const response = await fetch(
        "/api/platform/organization-directory/" +
          encodeURIComponent(selected.platform.id) +
          "/sync-identity",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ authOrganizationId: selected.identity.id }),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Unable to synchronize organization identity metadata");
      }
      setActionMessage("Platform name/slug synchronized from MigraAuth and audited.");
      await load(query, true);
    } catch (err) {
      setActionMessage(
        err instanceof Error ? err.message : "Unable to synchronize organization identity metadata",
      );
    } finally {
      setActionPending(false);
    }
  }

  if (authorized === false) return null;

  if (loading && !data) {
    return (
      <section className="mt-8 rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="grid min-h-56 place-items-center p-8">
          <div className="flex items-center gap-3 text-sm font-medium text-slate-600">
            <Loader2 size={18} className="animate-spin text-blue-600" />
            Loading platform tenant directory…
          </div>
        </div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="mt-8 rounded-3xl border border-rose-200 bg-rose-50 p-6">
        <h2 className="font-semibold text-rose-950">Platform tenant directory unavailable</h2>
        <p className="mt-2 text-sm leading-6 text-rose-800">
          {error ?? "The global organization control plane could not be loaded."}
        </p>
        <button
          onClick={() => void load(query)}
          className="mt-4 inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-800"
        >
          <RefreshCw size={15} /> Retry
        </button>
      </section>
    );
  }

  return (
    <section className="mt-8 space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-[linear-gradient(135deg,#0f172a,#172554)] p-6 text-white shadow-sm">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-200">
              MigraTeck operator control plane
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">Platform tenant directory</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
              Reconcile identity-backed organizations with Platform runtime tenants. This directory is global and does not depend on the operator being a member of the tenant.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.authority.roles.map((role) => (
              <span
                key={role}
                className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-100"
              >
                {role}
              </span>
            ))}
            {data.authority.viaBootstrap ? (
              <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-100">
                Bootstrap authority
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="Platform tenants" value={data.totals.platform} detail="runtime organization rows" />
        <Metric label="Identity orgs" value={data.totals.identity} detail="MigraAuth authority" />
        <Metric label="Linked" value={data.totals.linked} detail="identity + runtime agree" />
        <Metric
          label="Runtime-only"
          value={data.totals.platformOnlyRuntime}
          detail="unlinked with footprint"
          tone={data.totals.platformOnlyRuntime ? "amber" : "default"}
        />
        <Metric
          label="Empty legacy"
          value={data.totals.platformOnlyEmpty}
          detail="unlinked with no footprint"
        />
        <Metric
          label="Needs review"
          value={data.totals.needsReview}
          detail="reconciliation queue"
          tone={data.totals.needsReview ? "rose" : "default"}
        />
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 p-5 sm:p-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                Tenant reconciliation
              </p>
              <h3 className="mt-1 text-lg font-semibold text-slate-950">
                Identity, runtime, and access boundaries
              </h3>
            </div>
            <button
              onClick={() => void load(query, true)}
              disabled={refreshing}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="relative">
              <Search
                size={16}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search Platform tenant or organization slug…"
                className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm text-slate-800 outline-none focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10"
              />
            </div>
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 sm:grid-cols-5">
              {([
                ["review", "Needs review"],
                ["all", "All"],
                ["linked", "Linked"],
                ["platform-only", "Platform-only"],
                ["auth-only", "Auth-only"],
              ] as Array<[Filter, string]>).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  className={
                    "rounded-lg px-3 py-2 text-xs font-semibold transition " +
                    (filter === value
                      ? "bg-white text-slate-950 shadow-sm"
                      : "text-slate-500 hover:text-slate-800")
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid min-h-[34rem] xl:grid-cols-[0.78fr_1.22fr]">
          <div className="border-b border-slate-100 xl:border-b-0 xl:border-r">
            {filteredEntries.length === 0 ? (
              <div className="grid min-h-72 place-items-center p-8 text-center">
                <div>
                  <CheckCircle2 size={24} className="mx-auto text-emerald-500" />
                  <h4 className="mt-3 text-sm font-semibold text-slate-900">
                    No tenants in this view
                  </h4>
                  <p className="mt-1 text-sm text-slate-500">
                    Change the filter or search terms.
                  </p>
                </div>
              </div>
            ) : (
              <div className="max-h-[48rem] divide-y divide-slate-100 overflow-y-auto">
                {filteredEntries.map((entry) => {
                  const key = entryKey(entry);
                  const active = entryKey(selected ?? entry) === key;
                  const name = entry.platform?.name ?? entry.identity?.name ?? "Unknown organization";
                  const slug = entry.platform?.slug ?? entry.identity?.slug ?? "unknown";
                  return (
                    <button
                      key={key}
                      onClick={() => setSelectedKey(key)}
                      className={
                        "w-full p-4 text-left transition sm:p-5 " +
                        (active ? "bg-blue-50/70" : "hover:bg-slate-50")
                      }
                    >
                      <div className="flex items-start gap-3">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
                          <Building2 size={17} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-semibold text-slate-900">{name}</p>
                            <span
                              className={
                                "rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] " +
                                stateClass(entry.classification.state)
                              }
                            >
                              {stateLabel(entry.classification.state)}
                            </span>
                          </div>
                          <code className="mt-1 block truncate text-[10px] text-slate-400">{slug}</code>
                          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
                            <span>Footprint {footprintTotal(entry)}</span>
                            {entry.footprint?.failedProvisioning ? (
                              <span className="font-semibold text-rose-600">
                                {entry.footprint.failedProvisioning} failed jobs
                              </span>
                            ) : null}
                            {entry.platform?.isMigraHostingClient ? (
                              <span className="font-semibold text-blue-600">Hosting client</span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="min-w-0">
            {selected ? (
              <div className="space-y-6 p-5 sm:p-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-xl font-semibold tracking-tight text-slate-950">
                        {selected.platform?.name ?? selected.identity?.name}
                      </h4>
                      <span
                        className={
                          "rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] " +
                          stateClass(selected.classification.state)
                        }
                      >
                        {stateLabel(selected.classification.state)}
                      </span>
                    </div>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                      {selected.classification.reason}
                    </p>
                  </div>
                  {selected.classification.needsReview ? (
                    <span className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                      <AlertTriangle size={14} /> Review required
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                      <ShieldCheck size={14} /> Reconciled
                    </span>
                  )}
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <IdentityCard entry={selected} />
                  <PlatformCard entry={selected} />
                </div>

                {selected.footprint ? (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                      Runtime footprint
                    </p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <FootprintCard icon={<Users size={16} />} label="Members" value={selected.footprint.members} />
                      <FootprintCard icon={<Boxes size={16} />} label="Entitlements" value={selected.footprint.activeEntitlements} />
                      <FootprintCard icon={<CreditCard size={16} />} label="Subscriptions" value={selected.footprint.subscriptions} />
                      <FootprintCard icon={<Activity size={16} />} label="Pending jobs" value={selected.footprint.pendingProvisioning} />
                      <FootprintCard
                        icon={<AlertTriangle size={16} />}
                        label="Failed/dead jobs"
                        value={selected.footprint.failedProvisioning}
                        warn={selected.footprint.failedProvisioning > 0}
                      />
                      <FootprintCard icon={<KeyRound size={16} />} label="API keys" value={selected.footprint.activeApiKeys} />
                      <FootprintCard icon={<Webhook size={16} />} label="Webhooks" value={selected.footprint.activeWebhooks} />
                      <FootprintCard icon={<FileInput size={16} />} label="Intake forms" value={selected.footprint.intakeForms} />
                    </div>

                    <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-start gap-3">
                        <Server size={17} className="mt-0.5 text-blue-600" />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-900">Hosting tenant linkage</p>
                          <code className="mt-1 block break-all text-[11px] text-slate-500">
                            {selected.footprint.hostingTenantExternalId ?? "No active MigraPanel tenant binding"}
                          </code>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {data.authority.canManage ? (
                  <ReconciliationActions
                    entry={selected}
                    availableIdentities={availableIdentityOrganizations}
                    linkIdentityId={linkIdentityId}
                    setLinkIdentityId={setLinkIdentityId}
                    pending={actionPending}
                    message={actionMessage}
                    onLink={() => void linkIdentity()}
                    onSync={() => void syncIdentityMetadata()}
                  />
                ) : (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-600">
                    Global tenant reconciliation is OWNER-only. Your current platform role can inspect organization drift but cannot change identity linkage.
                  </div>
                )}

                {selected.platform?.isMigraHostingClient ? (
                  <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-xs leading-5 text-blue-800">
                    <strong>Hosting client classification is security-relevant.</strong> It participates in client-only distribution access and is intentionally read-only here until its own approval workflow is defined.
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="grid min-h-80 place-items-center p-8 text-center text-sm text-slate-500">
                Select a tenant to inspect identity and runtime evidence.
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string;
  value: number;
  detail: string;
  tone?: "default" | "amber" | "rose";
}) {
  const valueClass =
    tone === "rose"
      ? "text-rose-700"
      : tone === "amber"
        ? "text-amber-700"
        : "text-slate-950";
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className={"mt-2 text-2xl font-semibold tracking-tight " + valueClass}>{value.toLocaleString()}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </article>
  );
}

function IdentityCard({ entry }: { entry: DirectoryEntry }) {
  const identity = entry.identity;
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <ShieldCheck size={16} className={identity ? "text-emerald-600" : "text-slate-400"} />
        <h5 className="text-sm font-semibold text-slate-900">MigraAuth identity</h5>
      </div>
      {identity ? (
        <div className="mt-3 space-y-2 text-xs text-slate-600">
          <div>
            <span className="font-semibold text-slate-800">{identity.name}</span>
            <code className="ml-2 text-[10px] text-slate-400">{identity.slug}</code>
          </div>
          <p>{identity.active_member_count} active members · {identity.owner_count} active owner{identity.owner_count === 1 ? "" : "s"}</p>
          <p>Owner: {identity.owner.display_name ?? identity.owner.email ?? identity.owner.id}</p>
          <p>Owner status: <span className="font-semibold text-slate-800">{identity.owner.status}</span></p>
          <p>Owner last sign-in: {formatDate(identity.owner.last_login_at)}</p>
          <code className="block break-all text-[10px] text-slate-400">{identity.id}</code>
        </div>
      ) : (
        <p className="mt-3 text-xs leading-5 text-slate-500">
          No MigraAuth organization is linked to this Platform tenant.
        </p>
      )}
    </article>
  );
}

function PlatformCard({ entry }: { entry: DirectoryEntry }) {
  const platform = entry.platform;
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <Database size={16} className={platform ? "text-blue-600" : "text-slate-400"} />
        <h5 className="text-sm font-semibold text-slate-900">Platform runtime</h5>
      </div>
      {platform ? (
        <div className="mt-3 space-y-2 text-xs text-slate-600">
          <div>
            <span className="font-semibold text-slate-800">{platform.name}</span>
            <code className="ml-2 text-[10px] text-slate-400">{platform.slug}</code>
          </div>
          <p>Hosting client: <span className="font-semibold text-slate-800">{platform.isMigraHostingClient ? "Yes" : "No"}</span></p>
          <p>Updated: {formatDate(platform.updatedAt)}</p>
          <p>Created: {formatDate(platform.createdAt)}</p>
          <code className="block break-all text-[10px] text-slate-400">{platform.id}</code>
        </div>
      ) : (
        <p className="mt-3 text-xs leading-5 text-slate-500">
          No Platform organization mirror exists for this MigraAuth organization.
        </p>
      )}
    </article>
  );
}

function FootprintCard({
  icon,
  label,
  value,
  warn = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  warn?: boolean;
}) {
  return (
    <div className={"rounded-2xl border p-3 " + (warn ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-slate-50")}>
      <div className={"flex items-center gap-2 " + (warn ? "text-rose-700" : "text-slate-500")}>
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em]">{label}</span>
      </div>
      <p className={"mt-2 text-lg font-semibold " + (warn ? "text-rose-800" : "text-slate-900")}>{value.toLocaleString()}</p>
    </div>
  );
}

function ReconciliationActions({
  entry,
  availableIdentities,
  linkIdentityId,
  setLinkIdentityId,
  pending,
  message,
  onLink,
  onSync,
}: {
  entry: DirectoryEntry;
  availableIdentities: IdentityOrganization[];
  linkIdentityId: string;
  setLinkIdentityId: (value: string) => void;
  pending: boolean;
  message: string | null;
  onLink: () => void;
  onSync: () => void;
}) {
  const platform = entry.platform;
  const identity = entry.identity;
  const canLink = Boolean(platform && !platform.authOrganizationId);
  const canSync = Boolean(platform && identity && entry.classification.drift?.any);

  if (!canLink && !canSync) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs leading-5 text-emerald-800">
        No safe identity reconciliation action is required for this tenant.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center gap-2">
        <Link2 size={16} className="text-blue-600" />
        <h5 className="text-sm font-semibold text-slate-900">OWNER reconciliation controls</h5>
      </div>
      <p className="mt-1 text-xs leading-5 text-slate-500">
        These controls change identity linkage, not billing or product entitlements. Every write is audited.
      </p>

      {canLink ? (
        <div className="mt-4 space-y-3">
          {availableIdentities.length ? (
            <>
              <select
                value={linkIdentityId}
                onChange={(event) => setLinkIdentityId(event.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-blue-400"
              >
                <option value="">Select an unlinked MigraAuth organization…</option>
                {availableIdentities.map((identityOption) => (
                  <option key={identityOption.id} value={identityOption.id}>
                    {identityOption.name} ({identityOption.slug})
                  </option>
                ))}
              </select>
              <button
                onClick={onLink}
                disabled={pending || !linkIdentityId}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {pending ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />}
                Link identity organization
              </button>
            </>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs leading-5 text-slate-500">
              No unlinked MigraAuth organization is available. Do not attach this runtime tenant to an identity org that is already linked elsewhere.
            </div>
          )}
        </div>
      ) : null}

      {canSync && identity ? (
        <button
          onClick={onSync}
          disabled={pending}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
        >
          {pending ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          Sync Platform name/slug from MigraAuth
        </button>
      ) : null}

      {message ? (
        <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-medium text-slate-700">
          {message}
        </div>
      ) : null}
    </div>
  );
}
