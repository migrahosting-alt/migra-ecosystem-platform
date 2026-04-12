"use client";

import Link from "next/link";
import { useDeferredValue, useState } from "react";
import type { VpsFleetItem } from "@/lib/vps/types";
import { VpsFleetTable, VpsStatusBadge } from "@/components/app/vps-ui";

type FleetFilter = "all" | "running" | "attention" | "protected";
type FleetSort = "attention" | "name" | "cost";

function formatMoney(cents: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatDateTime(value?: string) {
  if (!value) {
    return "Never synced";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function isAttentionServer(server: VpsFleetItem) {
  return server.incidentOpen || server.openAlertCount > 0 || Boolean(server.driftType) || server.providerHealthState !== "HEALTHY";
}

function filterServer(server: VpsFleetItem, filter: FleetFilter, query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  if (normalizedQuery) {
    const haystack = [
      server.name,
      server.hostname,
      server.publicIpv4,
      server.region,
      server.osName,
      server.planLabel,
      server.providerSlug,
    ].join(" ").toLowerCase();

    if (!haystack.includes(normalizedQuery)) {
      return false;
    }
  }

  if (filter === "running") {
    return server.status === "RUNNING";
  }

  if (filter === "attention") {
    return isAttentionServer(server);
  }

  if (filter === "protected") {
    return server.backupsEnabled && server.firewallEnabled;
  }

  return true;
}

function sortServers(servers: VpsFleetItem[], sort: FleetSort) {
  return [...servers].sort((left, right) => {
    if (sort === "name") {
      return left.name.localeCompare(right.name);
    }

    if (sort === "cost") {
      return right.monthlyPriceCents - left.monthlyPriceCents;
    }

    const leftAttention = Number(isAttentionServer(left));
    const rightAttention = Number(isAttentionServer(right));

    if (leftAttention !== rightAttention) {
      return rightAttention - leftAttention;
    }

    return left.name.localeCompare(right.name);
  });
}

function EmptyFleetView({ hasActiveView, onReset }: { hasActiveView: boolean; onReset: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center">
      <p className="text-[13px] font-semibold text-slate-800">No servers match this view</p>
      <p className="mt-1 text-[12px] text-slate-500">
        {hasActiveView
          ? "Change the search, filter, or sort selection to widen the fleet view."
          : "Import or sync inventory to populate the fleet workspace."}
      </p>
      {hasActiveView ? (
        <button
          type="button"
          onClick={onReset}
          className="mt-4 inline-flex items-center justify-center rounded-lg border border-slate-200/60 bg-white px-4 py-2 text-[13px] font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
        >
          Reset view
        </button>
      ) : null}
    </div>
  );
}

export function VpsFleetInventoryClient({ servers }: { servers: VpsFleetItem[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FleetFilter>("all");
  const [sort, setSort] = useState<FleetSort>("attention");
  const deferredQuery = useDeferredValue(query);

  const filteredServers = sortServers(
    servers.filter((server) => filterServer(server, filter, deferredQuery)),
    sort,
  );

  const filterOptions: Array<{ key: FleetFilter; label: string; count: number }> = [
    { key: "all", label: "Visible", count: servers.length },
    { key: "running", label: "Running", count: servers.filter((server) => server.status === "RUNNING").length },
    { key: "attention", label: "Attention", count: servers.filter(isAttentionServer).length },
    { key: "protected", label: "Protected", count: servers.filter((server) => server.backupsEnabled && server.firewallEnabled).length },
  ];
  const visibleSpend = filteredServers.reduce((total, server) => total + server.monthlyPriceCents, 0);
  const visibleAttention = filteredServers.filter(isAttentionServer).length;
  const visibleProtected = filteredServers.filter((server) => server.backupsEnabled && server.firewallEnabled).length;
  const visibleMonitored = filteredServers.filter((server) => Boolean(server.monitoringStatus)).length;
  const normalizedQuery = deferredQuery.trim();
  const hasActiveView = normalizedQuery.length > 0 || filter !== "all" || sort !== "attention";

  function resetView() {
    setQuery("");
    setFilter("all");
    setSort("attention");
  }

  return (
    <div>
      <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">Servers</h2>
            <span className="inline-flex rounded-md border border-slate-200/60 bg-slate-50 px-2 py-0.5 text-[11px] font-medium tabular-nums text-slate-500">
              {filteredServers.length} visible
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {filterOptions.map((option) => {
              const active = option.key === filter;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setFilter(option.key)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200/60 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700"}`}
                >
                  <span className="tabular-nums">{option.count}</span>
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Visible spend</p>
              <p className="mt-1 text-base font-semibold tabular-nums text-slate-900">{formatMoney(visibleSpend)}</p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Needs review</p>
              <p className={`mt-1 text-base font-semibold tabular-nums ${visibleAttention > 0 ? "text-amber-600" : "text-slate-900"}`}>{visibleAttention}</p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Protected</p>
              <p className="mt-1 text-base font-semibold tabular-nums text-slate-900">{visibleProtected}/{filteredServers.length || 0}</p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Monitoring</p>
              <p className="mt-1 text-base font-semibold tabular-nums text-slate-900">{visibleMonitored}/{filteredServers.length || 0}</p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center lg:min-w-[370px] lg:justify-end">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-9 rounded-lg border border-slate-200/60 bg-white px-3.5 text-[13px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            placeholder="Search servers, IPs, plans"
          />
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as FleetSort)}
            className="h-9 rounded-lg border border-slate-200/60 bg-white px-3 text-[13px] font-medium text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
          >
            <option value="attention">Sort: Attention</option>
            <option value="name">Sort: Name</option>
            <option value="cost">Sort: Cost</option>
          </select>
          {hasActiveView ? (
            <button
              type="button"
              onClick={resetView}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200/60 bg-white px-3.5 text-[13px] font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
            >
              Clear view
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-2.5 text-[11px] text-slate-400">
        <span>Showing {filteredServers.length} of {servers.length} servers</span>
        {normalizedQuery ? (
          <span className="inline-flex rounded-md border border-indigo-100 bg-indigo-50 px-2 py-0.5 font-medium text-indigo-600">
            Query {normalizedQuery}
          </span>
        ) : null}
        {filter !== "all" ? (
          <span className="inline-flex rounded-md border border-slate-200/60 bg-slate-50 px-2 py-0.5 font-medium text-slate-500">
            Filter {filter}
          </span>
        ) : null}
        <span className="inline-flex rounded-md border border-slate-200/60 bg-slate-50 px-2 py-0.5 font-medium text-slate-500">
          Sort {sort}
        </span>
      </div>

      {filteredServers.length ? (
        <>
          <div className="hidden lg:block">
            <VpsFleetTable servers={filteredServers} />
          </div>

          <div className="space-y-3 p-4 lg:hidden">
            {filteredServers.map((server) => (
              <article key={server.id} className="rounded-xl border border-slate-200/60 bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-slate-900">{server.name}</p>
                    <p className="mt-0.5 text-[12px] text-slate-500">{server.hostname}</p>
                  </div>
                  <VpsStatusBadge status={server.status} />
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <span className="inline-flex rounded-md border border-indigo-100 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">
                    {server.providerSlug.toUpperCase()}
                  </span>
                  {server.openAlertCount > 0 ? (
                    <span className="inline-flex rounded-md border border-amber-200/60 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                      {server.openAlertCount} alerts
                    </span>
                  ) : null}
                  {server.incidentOpen ? (
                    <span className="inline-flex rounded-md border border-rose-200/60 bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-600">
                      Incident
                    </span>
                  ) : null}
                  {server.driftType ? (
                    <span className="inline-flex rounded-md border border-amber-200/60 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                      Drift
                    </span>
                  ) : null}
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Network</dt>
                    <dd className="mt-1 text-[13px] tabular-nums text-slate-900">{server.publicIpv4}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Region</dt>
                    <dd className="mt-1 text-[13px] text-slate-900">{server.region}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Plan</dt>
                    <dd className="mt-1 text-[13px] text-slate-900">{server.planLabel}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Cost</dt>
                    <dd className="mt-1 text-[13px] tabular-nums text-slate-900">{formatMoney(server.monthlyPriceCents, server.billingCurrency)}/mo</dd>
                  </div>
                </dl>

                <div className="mt-4 flex flex-wrap gap-1.5">
                  <span className={`inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${server.backupsEnabled ? "border-emerald-200/60 bg-emerald-50 text-emerald-600" : "border-slate-200 bg-slate-50 text-slate-400"}`}>
                    {server.backupsEnabled ? "Backups" : "No backups"}
                  </span>
                  <span className={`inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${server.firewallEnabled ? "border-indigo-200/60 bg-indigo-50 text-indigo-600" : "border-slate-200 bg-slate-50 text-slate-400"}`}>
                    {server.firewallEnabled ? "Firewall" : "Firewall off"}
                  </span>
                  <span className={`inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${server.monitoringStatus ? "border-emerald-200/60 bg-emerald-50 text-emerald-600" : "border-slate-200 bg-slate-50 text-slate-400"}`}>
                    {server.monitoringStatus ? "Monitoring" : "No monitoring"}
                  </span>
                </div>

                <p className="mt-3 text-[11px] text-slate-400">Last sync {formatDateTime(server.lastSyncedAt)}</p>

                <div className="mt-4 flex gap-2">
                  <Link href={`/app/vps/${server.id}`} className="inline-flex flex-1 items-center justify-center rounded-lg border border-slate-200/60 bg-white px-4 py-2 text-[13px] font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900">
                    Open
                  </Link>
                  <Link href={`/app/vps/${server.id}/console`} className="inline-flex flex-1 items-center justify-center rounded-lg border border-slate-200/60 bg-white px-4 py-2 text-[13px] font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900">
                    Console
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : (
        <div className="p-4">
          <EmptyFleetView hasActiveView={hasActiveView} onReset={resetView} />
        </div>
      )}
    </div>
  );
}