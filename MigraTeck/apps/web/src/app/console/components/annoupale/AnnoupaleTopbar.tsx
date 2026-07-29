"use client";

import { Search, Bell } from "lucide-react";

/**
 * AnnouPale Trust & Operations top bar. The search box submits a GET to the
 * compliance queue (?q=…) which the queue page sanitizes server-side and passes
 * to the AnnouPale list `search` filter. The attention badge is a REAL count
 * (urgent + high open compliance cases) passed from the server — never a
 * hardcoded number. When the count is unknown (a panel couldn't load) no badge
 * is shown rather than a fabricated value.
 */
export function AnnoupaleTopbar({
  operatorName,
  operatorRole,
  attentionCount,
  defaultQuery,
}: {
  operatorName: string;
  operatorRole: string;
  attentionCount: number | null;
  defaultQuery?: string | undefined;
}) {
  const initials = operatorName.slice(0, 2).toUpperCase();
  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/5 bg-[#0b1020]/80 px-4 py-3 backdrop-blur lg:px-6">
      <form
        method="get"
        action="/console/annoupale/compliance"
        className="relative flex-1 max-w-xl"
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input
          type="search"
          name="q"
          defaultValue={defaultQuery ?? ""}
          placeholder="Search cases by ID, requester, or handle…"
          className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-fuchsia-400/40 focus:outline-none focus:ring-2 focus:ring-fuchsia-400/20"
        />
      </form>

      <div className="ml-auto flex items-center gap-3">
        <span className="hidden items-center gap-1.5 rounded-md border border-violet-400/20 bg-violet-500/10 px-2.5 py-1 text-[11px] font-medium text-violet-200 sm:inline-flex">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Production
        </span>

        <span className="relative inline-flex">
          <Bell className="h-5 w-5 text-slate-400" />
          {attentionCount !== null && attentionCount > 0 && (
            <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-fuchsia-500 px-1 text-[9px] font-semibold text-white">
              {attentionCount > 99 ? "99+" : attentionCount}
            </span>
          )}
        </span>

        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-fuchsia-500/30 to-amber-400/20 text-[11px] font-semibold text-white">
            {initials}
          </span>
          <span className="hidden min-w-0 leading-tight sm:block">
            <span className="block truncate text-[13px] font-medium text-white">{operatorName}</span>
            <span className="block truncate text-[10px] text-slate-500">{operatorRole}</span>
          </span>
        </div>
      </div>
    </header>
  );
}
