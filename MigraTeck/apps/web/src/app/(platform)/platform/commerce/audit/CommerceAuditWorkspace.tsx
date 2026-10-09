"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";

type Family = "billing" | "entitlement" | "provisioning" | "revenue" | "usage";

type Entry = {
  id: string;
  actorId: string | null;
  orgId: string | null;
  orgName: string | null;
  orgSlug: string | null;
  action: string;
  family: Family;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type Payload = {
  total: number;
  limit: number;
  offset: number;
  evidenceWindow: { newestAt: string | null; oldestAt: string | null };
  familyCounts: Record<Family, number>;
  entries: Entry[];
};

const families: Array<{ value: "" | Family; label: string }> = [
  { value: "", label: "All commerce" },
  { value: "billing", label: "Billing" },
  { value: "entitlement", label: "Entitlements" },
  { value: "provisioning", label: "Provisioning" },
  { value: "revenue", label: "Revenue" },
  { value: "usage", label: "Usage" },
];

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

export function CommerceAuditWorkspace() {
  const [data, setData] = useState<Payload | null>(null);
  const [family, setFamily] = useState<"" | Family>("");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [action, setAction] = useState("");
  const [orgId, setOrgId] = useState("");
  const [actorId, setActorId] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: "50",
        offset: String(offset),
      });
      if (family) params.set("family", family);
      if (appliedQuery) params.set("q", appliedQuery);
      if (action.trim()) params.set("action", action.trim());
      if (orgId.trim()) params.set("orgId", orgId.trim());
      if (actorId.trim()) params.set("actorId", actorId.trim());

      const response = await fetch(
        "/api/platform/commerce/audit?" + params.toString(),
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Unable to load commerce audit evidence");
      }
      setData(body);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load commerce audit evidence",
      );
    } finally {
      setLoading(false);
    }
  }, [family, appliedQuery, action, orgId, actorId, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeFilters = useMemo(
    () =>
      [
        family,
        appliedQuery,
        action.trim(),
        orgId.trim(),
        actorId.trim(),
      ].filter(Boolean).length,
    [family, appliedQuery, action, orgId, actorId],
  );

  const pageStart = data?.total ? data.offset + 1 : 0;
  const pageEnd = data
    ? Math.min(data.total, data.offset + data.entries.length)
    : 0;
  const canBack = (data?.offset ?? 0) > 0;
  const canNext = data ? data.offset + data.limit < data.total : false;

  function applyFilters() {
    setOffset(0);
    setAppliedQuery(query.trim());
  }

  function clearFilters() {
    setFamily("");
    setQuery("");
    setAppliedQuery("");
    setAction("");
    setOrgId("");
    setActorId("");
    setOffset(0);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              <ShieldCheck size={14} />
              Read-only evidence plane
            </div>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
              Commerce mutations remain in their owning modules. This workspace
              only reads the append-only platform audit ledger and exposes
              allowlisted metadata.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {families.slice(1).map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => {
              setFamily(item.value as Family);
              setOffset(0);
            }}
            className={
              "rounded-2xl border p-4 text-left transition " +
              (family === item.value
                ? "border-blue-300 bg-blue-50"
                : "border-slate-200 bg-white hover:border-blue-200")
            }
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              {item.label}
            </p>
            <p className="mt-2 text-xl font-semibold text-slate-950">
              {data?.familyCounts[item.value as Family]?.toLocaleString() ??
                "—"}
            </p>
          </button>
        ))}
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Evidence rows
          </p>
          <p className="mt-2 text-xl font-semibold text-slate-950">
            {data?.total.toLocaleString() ?? "—"}
          </p>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Filter size={16} />
            Server-side filters
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-5">
            <label className="xl:col-span-2">
              <span className="text-xs font-semibold text-slate-600">
                Search evidence
              </span>
              <div className="relative mt-1.5">
                <Search
                  size={15}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") applyFilters();
                  }}
                  placeholder="Action, entity, organization…"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-blue-400 focus:bg-white"
                />
              </div>
            </label>

            <label>
              <span className="text-xs font-semibold text-slate-600">
                Exact action
              </span>
              <input
                value={action}
                onChange={(event) => setAction(event.target.value)}
                placeholder="BILLING_RECONCILED"
                className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3 font-mono text-xs outline-none focus:border-blue-400"
              />
            </label>

            <label>
              <span className="text-xs font-semibold text-slate-600">
                Organization ID
              </span>
              <input
                value={orgId}
                onChange={(event) => setOrgId(event.target.value)}
                className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3 font-mono text-xs outline-none focus:border-blue-400"
              />
            </label>

            <label>
              <span className="text-xs font-semibold text-slate-600">
                Actor ID
              </span>
              <input
                value={actorId}
                onChange={(event) => setActorId(event.target.value)}
                className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3 font-mono text-xs outline-none focus:border-blue-400"
              />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {families.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  setFamily(item.value);
                  setOffset(0);
                }}
                className={
                  "rounded-full px-3 py-1.5 text-xs font-semibold " +
                  (family === item.value
                    ? "bg-slate-950 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200")
                }
              >
                {item.label}
              </button>
            ))}
            <button
              type="button"
              onClick={applyFilters}
              className="ml-auto rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white"
            >
              Apply filters
            </button>
            {activeFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700"
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>

        {error ? (
          <div className="m-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            {error}
          </div>
        ) : null}

        {loading && !data ? (
          <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 size={17} className="animate-spin" />
            Loading commerce evidence…
          </div>
        ) : data?.entries.length ? (
          <div className="divide-y divide-slate-100">
            {data.entries.map((entry) => (
              <article key={entry.id} className="p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-blue-700">
                        {entry.family}
                      </span>
                      <code className="text-xs font-semibold text-slate-900">
                        {entry.action}
                      </code>
                    </div>
                    <p className="mt-2 text-sm text-slate-700">
                      {entry.entityType}
                      <span className="text-slate-400"> · </span>
                      <code className="text-xs">{entry.entityId}</code>
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {entry.orgName ?? "Platform scope"}
                      {entry.orgSlug ? " · " + entry.orgSlug : ""}
                      {entry.actorId ? " · actor " + entry.actorId : ""}
                    </p>
                  </div>
                  <p className="shrink-0 text-xs text-slate-500">
                    {formatDate(entry.createdAt)}
                  </p>
                </div>

                {Object.keys(entry.metadata).length ? (
                  <div className="mt-3 grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-2 xl:grid-cols-3">
                    {Object.entries(entry.metadata).map(([key, value]) => (
                      <div key={key} className="min-w-0">
                        <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                          {key}
                        </p>
                        <code className="mt-1 block break-all text-[11px] text-slate-700">
                          {typeof value === "string"
                            ? value
                            : JSON.stringify(value)}
                        </code>
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center text-sm text-slate-500">
            No commerce audit evidence matches these filters.
          </div>
        )}

        <div className="flex flex-col gap-3 border-t border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-slate-500">
            {data && data.total
              ? "Showing " +
                pageStart +
                "-" +
                pageEnd +
                " of " +
                data.total.toLocaleString()
              : "No rows"}
            {data?.evidenceWindow.oldestAt
              ? " · evidence " +
                formatDate(data.evidenceWindow.oldestAt) +
                " → " +
                formatDate(data.evidenceWindow.newestAt)
              : ""}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!canBack || loading}
              onClick={() =>
                setOffset(
                  Math.max(0, (data?.offset ?? 0) - (data?.limit ?? 50)),
                )
              }
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold disabled:opacity-40"
            >
              <ChevronLeft size={14} />
              Previous
            </button>
            <button
              type="button"
              disabled={!canNext || loading}
              onClick={() =>
                setOffset((data?.offset ?? 0) + (data?.limit ?? 50))
              }
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold disabled:opacity-40"
            >
              Next
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
