/**
 * Normalize `/console/pale/reports` query parameters into the `ReportFilters` contract.
 *
 * Pure and dependency-light so the mapping is unit-testable without a database or a request.
 * The page reads `searchParams` on the server and passes the result straight to
 * `getPaleReports(options)` — there is no client-side fetching.
 *
 * NAME MISMATCH, deliberately absorbed here: the URL says `type` because that is what the
 * filter bar has always emitted, while the data contract says `targetType`. Translating in one
 * place keeps the query string stable for anyone with a bookmark and keeps the contract honest.
 *
 * Everything is validated rather than trusted. An unknown status or a malformed date is
 * DROPPED, not passed through and not thrown on: a bad query string should show an unfiltered
 * page, never a 500.
 */

import type { ReportFilters } from "../../lib/pale-reports-query";

/**
 * Mirrors REPORT_STATUSES, kept local so this module has NO runtime import and can be unit
 * tested directly. `report-filter-params.test.ts` asserts this list is identical to the
 * contract's and to the filter bar's copy, so the three cannot drift apart.
 */
const STATUSES = [
  "pending", "reviewing", "escalated", "reviewed", "dismissed", "actioned",
] as const;

/** Raw Next.js searchParams shape. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

/** The values echoed back into the filter bar, always strings so inputs stay controlled. */
export type ReportFilterView = {
  status: string;
  type: string;
  from: string;
  to: string;
};

/** A repeated param (`?status=a&status=b`) yields an array; take the first and trim. */
const one = (v: string | string[] | undefined): string =>
  (Array.isArray(v) ? v[0] ?? "" : v ?? "").trim();

/**
 * `YYYY-MM-DD` only, and it must be a real calendar date.
 *
 * The round-trip check rejects `2026-02-31`, which passes a regex but rolls over to March —
 * silently returning the wrong window is worse than ignoring the filter.
 */
export const isValidDate = (s: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const isKnownStatus = (s: string): boolean => (STATUSES as readonly string[]).includes(s);

/**
 * The values to echo into the filter bar: only what survived validation, so the UI never
 * shows a filter that is not actually applied.
 */
export const toFilterView = (sp: RawSearchParams): ReportFilterView => {
  const status = one(sp["status"]);
  const from = one(sp["from"]);
  const to = one(sp["to"]);
  return {
    status: isKnownStatus(status) ? status : "",
    type: one(sp["type"]),
    from: isValidDate(from) ? from : "",
    to: isValidDate(to) ? to : "",
  };
};

/**
 * Build the `getPaleReports` argument.
 *
 * `limit` is the caller's, not this module's: the reports page has always asked for 25, and
 * that page-level choice is preserved whether or not filters are present. The contract's own
 * default of 8 is for callers that pass nothing.
 */
export const toReportFilters = (sp: RawSearchParams, limit: number): ReportFilters => {
  const view = toFilterView(sp);
  const filters: ReportFilters = { limit };
  if (view.status) filters.status = view.status;
  if (view.type) filters.targetType = view.type;
  if (view.from) filters.from = view.from;
  if (view.to) filters.to = view.to;
  return filters;
};

/** True when no usable filter survived validation — the canonical unfiltered view. */
export const hasNoFilters = (sp: RawSearchParams): boolean => {
  const v = toFilterView(sp);
  return !v.status && !v.type && !v.from && !v.to;
};
