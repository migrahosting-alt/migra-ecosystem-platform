"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

/**
 * Live search/filter for /console/clients. Updates the q= and status= query
 * params, triggering a server re-render with filtered rows.
 *
 * The text input is debounced (250ms) so we don't hammer the server on every
 * keystroke. The status select updates immediately.
 */
const DEBOUNCE_MS = 250;

export const ClientSearchBar = ({
  statuses,
}: {
  statuses: ReadonlyArray<string>;
}) => {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") || "");
  const [status, setStatus] = useState(params.get("status") || "");
  const [, startTransition] = useTransition();
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buildUrl = (nq: string, ns: string): string => {
    const sp = new URLSearchParams();
    if (nq) sp.set("q", nq);
    if (ns) sp.set("status", ns);
    const qs = sp.toString();
    return qs ? `/console/clients?${qs}` : "/console/clients";
  };

  const navigate = (nq: string, ns: string) => {
    startTransition(() => router.replace(buildUrl(nq, ns)));
  };

  const onQueryChange = (next: string) => {
    setQ(next);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => navigate(next, status), DEBOUNCE_MS);
  };

  const onStatusChange = (next: string) => {
    setStatus(next);
    // Status changes immediately — no debounce needed
    navigate(q, next);
  };

  // Clean up pending timer on unmount
  useEffect(
    () => () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    },
    [],
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
        <input
          type="text"
          value={q}
          placeholder="Search by name, domain, or email…"
          onChange={(e) => onQueryChange(e.target.value)}
          className="w-full rounded-md border border-white/10 bg-white/5 pl-9 pr-9 py-2 text-xs text-white placeholder:text-slate-500 focus:border-fuchsia-400/40 focus:outline-none focus:ring-2 focus:ring-fuchsia-400/20"
        />
        {q && (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-white"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      <select
        value={status}
        onChange={(e) => onStatusChange(e.target.value)}
        className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white focus:border-fuchsia-400/40 focus:outline-none focus:ring-2 focus:ring-fuchsia-400/20"
      >
        <option value="" className="bg-slate-900">All statuses</option>
        {statuses.map((s) => (
          <option key={s} value={s} className="bg-slate-900">
            {s}
          </option>
        ))}
      </select>
    </div>
  );
};
