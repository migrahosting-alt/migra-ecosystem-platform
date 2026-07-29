import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildReportsQuery } from "../../lib/pale-reports-query.ts";
import {
  hasNoFilters,
  isValidDate,
  toFilterView,
  toReportFilters,
  type RawSearchParams,
} from "./report-filter-params.ts";

/**
 * Report-filter wiring.
 *
 * ReportFiltersBar sat orphaned because canonical only had `getPaleReports(limit: number)`.
 * The additive object overload gave it a runtime path; these tests pin the mapping between
 * what the URL carries and what the data contract accepts, including the `type` -> `targetType`
 * rename that the two sides disagree on.
 *
 * The rule throughout: a bad query string produces an unfiltered page, never an exception.
 */

const PAGE_LIMIT = 25;
const f = (sp: RawSearchParams) => toReportFilters(sp, PAGE_LIMIT);

test("NO query parameters preserves canonical unfiltered behaviour", () => {
  // The page has always asked for 25; filtering must not change that when nothing is filtered.
  assert.deepEqual(f({}), { limit: PAGE_LIMIT });
  assert.equal(hasNoFilters({}), true);
  const { sql, params } = buildReportsQuery(f({}));
  assert.doesNotMatch(sql, /WHERE/, "an unfiltered page must add no predicate");
  assert.deepEqual(params, [PAGE_LIMIT]);
});

test("each filter works independently", () => {
  assert.deepEqual(f({ status: "pending" }), { limit: PAGE_LIMIT, status: "pending" });
  assert.deepEqual(f({ type: "post" }), { limit: PAGE_LIMIT, targetType: "post" });
  assert.deepEqual(f({ from: "2026-01-01" }), { limit: PAGE_LIMIT, from: "2026-01-01" });
  assert.deepEqual(f({ to: "2026-03-01" }), { limit: PAGE_LIMIT, to: "2026-03-01" });
});

test("combined filters all survive together", () => {
  const out = f({ status: "escalated", type: "comment", from: "2026-01-01", to: "2026-02-01" });
  assert.deepEqual(out, {
    limit: PAGE_LIMIT,
    status: "escalated",
    targetType: "comment",
    from: "2026-01-01",
    to: "2026-02-01",
  });
  const { params } = buildReportsQuery(out);
  assert.equal(params.length, 5, "four predicates plus the limit");
  assert.equal(params[params.length - 1], PAGE_LIMIT, "limit stays last");
});

test("the URL's `type` maps to the contract's `targetType` — and only that", () => {
  // The two sides genuinely disagree on the name; this is the single translation point.
  const out = f({ type: "profile" });
  assert.equal(out.targetType, "profile");
  assert.ok(!("type" in out), "`type` must not leak into the contract");
  const { sql } = buildReportsQuery(out);
  assert.match(sql, /r\.target_type = \$/);
});

test("malformed dates are DROPPED, never thrown on and never passed through", () => {
  for (const bad of [
    "not-a-date",
    "2026-13-01", // month 13
    "2026-02-31", // rolls over to March — regex-valid, calendar-invalid
    "01-01-2026", // wrong order
    "2026-1-1", // unpadded
    "",
    "2026-01-01T00:00:00Z", // datetime, not a date
  ]) {
    assert.equal(isValidDate(bad), false, `${bad} must be rejected`);
    const out = f({ from: bad, to: bad });
    assert.ok(!("from" in out) && !("to" in out), `${bad} must not reach the contract`);
    assert.deepEqual(out, { limit: PAGE_LIMIT });
  }
  assert.equal(isValidDate("2026-02-28"), true, "a real date must still pass");
});

test("an unsupported status is dropped rather than queried", () => {
  const out = f({ status: "'; DROP TABLE reports; --" });
  assert.deepEqual(out, { limit: PAGE_LIMIT });
  const { sql, params } = buildReportsQuery(out);
  assert.doesNotMatch(sql, /DROP TABLE/);
  assert.deepEqual(params, [PAGE_LIMIT]);
});

test("the echoed view shows only filters that were actually applied", () => {
  // Otherwise the bar would display a filter the results do not reflect.
  const view = toFilterView({ status: "bogus", from: "2026-99-99", type: "post" });
  assert.deepEqual(view, { status: "", type: "post", from: "", to: "" });
});

test("clearing filters returns to the canonical unfiltered request", () => {
  // The bar's Clear pushes the bare path; that must reproduce the no-parameter behaviour.
  assert.deepEqual(f({}), f({ status: "", type: "", from: "", to: "" }));
  assert.equal(hasNoFilters({ status: "", type: "  ", from: "", to: "" }), true);
});

test("canonical ordering is stable across every filter combination", () => {
  for (const sp of [
    {},
    { status: "pending" },
    { type: "post" },
    { from: "2026-01-01", to: "2026-02-01" },
    { status: "actioned", type: "comment", from: "2026-01-01", to: "2026-02-01" },
  ] as RawSearchParams[]) {
    const { sql } = buildReportsQuery(f(sp));
    assert.match(sql, /ORDER BY r\.created_at DESC/);
    assert.equal((sql.match(/ORDER BY/g) ?? []).length, 1);
  }
});

test("filter values are encoded, never interpolated, in generated URLs", () => {
  // ReportFiltersBar builds its query with URLSearchParams, which percent-encodes. This pins
  // that choice: a hand-built template string would emit an injectable URL.
  const bar = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ReportFilters.tsx"), "utf8");
  assert.match(bar, /new URLSearchParams\(\)/, "the bar must build its query with URLSearchParams");
  assert.match(bar, /q\.set\("status"/);
  assert.match(bar, /q\.set\("type"/);

  const q = new URLSearchParams();
  q.set("type", 'a&b=c#d e"/');
  const url = `/console/pale/reports?${q.toString()}`;
  for (const raw of ["&b=", "#d", ' ', '"']) {
    assert.ok(!url.includes(`type=${raw}`), `raw ${JSON.stringify(raw)} must not appear unencoded`);
  }
  // …and it round-trips back to the original value.
  assert.equal(new URLSearchParams(url.split("?")[1]).get("type"), 'a&b=c#d e"/');
});

test("a repeated parameter takes the first value instead of crashing", () => {
  assert.deepEqual(f({ status: ["pending", "actioned"] }), { limit: PAGE_LIMIT, status: "pending" });
  assert.deepEqual(f({ type: [] }), { limit: PAGE_LIMIT });
});

test("no client-side fetching was introduced", () => {
  // The page must remain a server component that reads searchParams; the bar only navigates.
  const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf8");
  assert.doesNotMatch(page, /"use client"/, "the reports page must stay a server component");
  assert.match(page, /await searchParams/);
  const bar = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ReportFilters.tsx"), "utf8");
  assert.doesNotMatch(bar, /\bfetch\(/, "the filter bar must navigate, not fetch");
});

test("the three copies of the status list are identical — they cannot drift", () => {
  /**
   * The list exists in three places for good reasons: the data contract owns it, the client
   * bar cannot import server-only code, and this module must stay runtime-import-free so it
   * is directly testable. Duplication is acceptable only while something proves they agree.
   */
  const here = dirname(fileURLToPath(import.meta.url));
  const listFrom = (file: string, name: string): string[] => {
    const src = readFileSync(file, "utf8");
    const m = new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`, "s").exec(src);
    assert.ok(m, `${name} not found in ${file}`);
    return [...m![1]!.matchAll(/"([a-z_]+)"/g)].map((x) => x[1]!);
  };
  const contract = listFrom(join(here, "..", "..", "lib", "pale-reports-query.ts"), "REPORT_STATUSES");
  const params = listFrom(join(here, "report-filter-params.ts"), "STATUSES");
  const bar = listFrom(join(here, "ReportFilters.tsx"), "STATUSES");
  assert.deepEqual(params, contract, "report-filter-params drifted from the contract");
  assert.deepEqual(bar, contract, "the filter bar drifted from the contract");
  assert.ok(contract.length > 0);
});
