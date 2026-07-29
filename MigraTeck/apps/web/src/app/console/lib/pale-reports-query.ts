/**
 * Pure query construction for the Pale reports readers.
 *
 * Split out of `pale-live.ts` deliberately: that module opens a database pool at import
 * time, so nothing in it can be unit-tested without one. Everything here is pure string
 * and parameter assembly with NO imports, which makes the contract — default limit,
 * ordering, filter composition, parameterization — directly testable.
 *
 * `pale-live.ts` re-exports the public names, so callers keep importing from there.
 */

/** Valid report statuses (mirrors the ReportStatus enum). Used to validate filters. */
export const REPORT_STATUSES = [
  "pending", "reviewing", "escalated", "reviewed", "dismissed", "actioned",
] as const;

/** Optional filters for the reports list. Every field is additive. */
export type ReportFilters = {
  status?: string;
  targetType?: string;
  from?: string;
  to?: string;
  limit?: number;
};

/** The canonical default page size. Unchanged from the original numeric signature. */
const REPORTS_DEFAULT_LIMIT = 8;

/**
 * Shared column list and row mapper for both report readers. Private on purpose —
 * nothing outside this module needs the raw row shape, and exporting it would turn an
 * internal SQL detail into a contract.
 */
const REPORT_SELECT =
  `r.id, r.target_type, r.target_id, r.reason, r.details, r.status,
   ru.phone_number AS reporter_phone, r.created_at
     FROM reports r
     LEFT JOIN users ru ON ru.id = r.reporter_id`;

/**
 * Normalize the two accepted argument forms to one filter object.
 *
 * Limit handling deliberately preserves the canonical numeric contract rather than
 * adopting the historical clamp to [1,100]:
 *   undefined            -> REPORTS_DEFAULT_LIMIT (8)
 *   non-negative integer -> used verbatim, including 0 (LIMIT 0 is valid SQL and
 *                           canonically returns an empty list)
 *   anything else        -> REPORTS_DEFAULT_LIMIT
 *
 * "Anything else" is NaN, Infinity, a negative number and a fractional number — inputs
 * canonical would have passed straight into LIMIT $1 to fail at the database. Normalizing
 * those is a repair, not a contract change; clamping a caller's legitimate 250 would have
 * been the contract change, so it is not done here.
 */
const normalizeReportArgs = (arg?: number | ReportFilters): ReportFilters => {
  const opts: ReportFilters = typeof arg === "number" ? { limit: arg } : { ...(arg ?? {}) };
  const l = opts.limit;
  opts.limit =
    l === undefined || !Number.isInteger(l) || (l as number) < 0 ? REPORTS_DEFAULT_LIMIT : l;
  return opts;
};

/**
 * Build the reports query without executing it.
 *
 * Split out from `getPaleReports` so the contract — argument normalization, filter
 * composition, parameterization and ordering — is testable without a database. Exported
 * for tests only; production callers use `getPaleReports`.
 *
 * @internal
 */
export const buildReportsQuery = (
  arg?: number | ReportFilters,
): { sql: string; params: Array<string | number> } => {
  const opts = normalizeReportArgs(arg);
  const where: string[] = [];
  const params: Array<string | number> = [];

  // status is cast to text and checked against the known set: an unrecognised status is
  // ignored rather than injected, so a bad filter narrows nothing instead of erroring.
  if (opts.status && (REPORT_STATUSES as readonly string[]).includes(opts.status)) {
    params.push(opts.status);
    where.push(`r.status::text = $${params.length}`);
  }
  if (opts.targetType) {
    params.push(opts.targetType);
    where.push(`r.target_type = $${params.length}`);
  }
  if (opts.from) {
    params.push(opts.from);
    where.push(`r.created_at >= $${params.length}`);
  }
  if (opts.to) {
    params.push(opts.to);
    where.push(`r.created_at <= $${params.length}`);
  }
  params.push(opts.limit as number);

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  // ORDER BY created_at DESC is canonical ordering and is NOT filter-dependent.
  const sql = `SELECT ${REPORT_SELECT}
       ${whereSql}
      ORDER BY r.created_at DESC
      LIMIT $${params.length}`;
  return { sql, params };
};

/** Build the single-report query without executing it. Exported for tests only. @internal */
export const buildReportQuery = (id: string): { sql: string; params: Array<string | number> } => ({
  sql: `SELECT ${REPORT_SELECT}
      WHERE r.id = $1
      LIMIT 1`,
  params: [id],
});
