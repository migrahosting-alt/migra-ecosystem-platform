"use client";

import { useEffect, useState } from "react";

type AuditEntry = {
  id: string;
  event_type: string;
  event_data: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

export function ComplianceWorkspace() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const limit = 25;

  useEffect(() => {
    loadAudit();
  }, [offset]);

  async function loadAudit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/platform/compliance/audit?limit=${limit}&offset=${offset}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "Failed to load audit log.");
        return;
      }
      const body = await res.json();
      setEntries(body.audit_logs ?? []);
      setTotal(body.total ?? 0);
    } catch {
      setError("Unable to reach audit service.");
    } finally {
      setLoading(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.floor(offset / limit) + 1;
  const filteredEntries = entries.filter((entry) => {
    const haystack = `${entry.event_type} ${JSON.stringify(entry.event_data)} ${entry.ip_address ?? ""} ${entry.user_agent ?? ""}`.toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  });
  const identityEvents = filteredEntries.filter((entry) => /login|session|mfa|password/i.test(entry.event_type)).length;
  const accessEvents = filteredEntries.filter((entry) => /org|member|invite|role/i.test(entry.event_type)).length;
  const latestEvent = filteredEntries[0]?.created_at ?? entries[0]?.created_at ?? null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Audit evidence</h2>
          <p className="mt-2 text-sm text-slate-500">
            Review operator activity captured by MigraAuth. Search the current page to isolate sign-in, access, and administrative events without exposing raw backend responses.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:min-w-80">
          <label htmlFor="audit-search" className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
            Search current page
          </label>
          <input
            id="audit-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search event type, IP, or payload"
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Events in scope</p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{filteredEntries.length}</p>
          <p className="mt-2 text-sm text-slate-500">Showing {filteredEntries.length} entries from page {currentPage}. Total recorded events: {total}.</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Identity activity</p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{identityEvents}</p>
          <p className="mt-2 text-sm text-slate-500">Sign-in, MFA, password, and session events visible in the current evidence set.</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Access changes</p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{accessEvents}</p>
          <p className="mt-2 text-sm text-slate-500">
            {latestEvent ? `Latest retained event: ${new Date(latestEvent).toLocaleString()}.` : "No retained events are visible yet."}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="mt-6 flex justify-center py-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
        </div>
      ) : error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      ) : filteredEntries.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">No audit events recorded yet.</p>
      ) : (
        <>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                  <th className="pb-3 pr-4">Event</th>
                  <th className="pb-3 pr-4">IP</th>
                  <th className="pb-3 pr-4">Details</th>
                  <th className="pb-3">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="py-3 pr-4">
                      <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                        {entry.event_type}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-slate-600 text-xs">
                      {entry.ip_address ?? "—"}
                    </td>
                    <td className="py-3 pr-4 text-slate-600 text-xs max-w-xs">
                      {Object.keys(entry.event_data).length > 0
                        ? JSON.stringify(entry.event_data, null, 0).slice(0, 140)
                        : "—"}
                    </td>
                    <td className="py-3 text-slate-600 text-xs whitespace-nowrap">
                      {new Date(entry.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setOffset(Math.max(0, offset - limit))}
                disabled={offset === 0}
                className="text-sm font-medium text-blue-600 hover:text-blue-700 disabled:text-slate-400 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="text-xs text-slate-400">
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setOffset(offset + limit)}
                disabled={offset + limit >= total}
                className="text-sm font-medium text-blue-600 hover:text-blue-700 disabled:text-slate-400 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
