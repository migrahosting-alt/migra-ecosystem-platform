import assert from "node:assert/strict";
import test from "node:test";
import { buildReportQuery, buildReportsQuery, REPORT_STATUSES } from "./pale-reports-query.ts";

/**
 * Contract tests for the additive getPaleReports overload.
 *
 * The canonical numeric form `getPaleReports(limit?: number)` predates the filter object
 * and still has live callers. These tests exist to prove the object form was added
 * ALONGSIDE it rather than replacing it — the historical branch replaced the signature
 * outright, which is what made the file unmergeable.
 *
 * Query construction is tested rather than execution: `buildReportsQuery` is pure, so the
 * default limit, ordering, filter composition and parameterization can all be pinned
 * without a database. That is a real contract, not a proxy for one — the SQL and its
 * bound parameters ARE what the function promises.
 */

const paramCount = (sql: string): number => new Set(sql.match(/\$\d+/g) ?? []).size;

test("legacy numeric caller: getPaleReports(5) still binds exactly one limit param", () => {
  const { sql, params } = buildReportsQuery(5);
  assert.deepEqual(params, [5]);
  assert.match(sql, /LIMIT \$1/);
  assert.doesNotMatch(sql, /WHERE/, "a bare numeric call must not add predicates");
});

test("default invocation preserves the canonical limit of 8", () => {
  for (const arg of [undefined, {}] as Array<number | undefined | Record<string, never>>) {
    const { params } = buildReportsQuery(arg as undefined);
    assert.deepEqual(params, [8], `default limit changed for ${JSON.stringify(arg)}`);
  }
});

test("canonical ordering is stable and never filter-dependent", () => {
  // Ordering is part of the result shape callers rely on. A filter must never reorder.
  const variants = [
    buildReportsQuery(),
    buildReportsQuery(3),
    buildReportsQuery({ status: "pending" }),
    buildReportsQuery({ targetType: "post", from: "2026-01-01", to: "2026-02-01", limit: 4 }),
  ];
  for (const { sql } of variants) {
    assert.match(sql, /ORDER BY r\.created_at DESC/);
    assert.equal((sql.match(/ORDER BY/g) ?? []).length, 1, "exactly one ORDER BY");
  }
});

test("filtered invocation composes predicates and parameterizes every value", () => {
  const { sql, params } = buildReportsQuery({ status: "reviewing", targetType: "comment" });
  assert.match(sql, /WHERE/);
  assert.match(sql, /r\.status::text = \$1/);
  assert.match(sql, /r\.target_type = \$2/);
  assert.deepEqual(params, ["reviewing", "comment", 8]);
  // No literal may reach the SQL text — everything travels as a bound parameter.
  assert.doesNotMatch(sql, /reviewing|comment/);
});

test("limit plus filters: the limit is always the LAST bound parameter", () => {
  const { sql, params } = buildReportsQuery({
    status: "escalated",
    targetType: "post",
    from: "2026-01-01",
    to: "2026-03-01",
    limit: 25,
  });
  assert.equal(params.length, 5);
  assert.equal(params[params.length - 1], 25);
  assert.match(sql, new RegExp(`LIMIT \\$${params.length}`));
  assert.equal(paramCount(sql), 5, "every parameter is referenced exactly once");
});

test("an unrecognised status is ignored, never injected", () => {
  const { sql, params } = buildReportsQuery({ status: "'; DROP TABLE reports; --" });
  assert.doesNotMatch(sql, /DROP TABLE/);
  assert.deepEqual(params, [8], "a bogus status must narrow nothing");
});

test("every documented status is accepted as a filter", () => {
  for (const s of REPORT_STATUSES) {
    const { params } = buildReportsQuery({ status: s });
    assert.deepEqual(params, [s, 8], `status ${s} should filter`);
  }
});

test("invalid limits normalize to the default; valid ones pass through verbatim", () => {
  // Canonical passed the value straight to LIMIT $1. Values it handled sanely still do.
  for (const good of [0, 1, 8, 250]) {
    assert.deepEqual(buildReportsQuery(good).params, [good], `limit ${good} must be verbatim`);
  }
  // These would have reached the database as errors. Repairing them is not a contract change.
  for (const bad of [-1, 1.5, NaN, Infinity]) {
    assert.deepEqual(buildReportsQuery(bad).params, [8], `limit ${bad} must normalize`);
  }
});

test("getPaleReport builds a parameterized primary-key lookup", () => {
  const { sql, params } = buildReportQuery("abc-123");
  assert.deepEqual(params, ["abc-123"]);
  assert.match(sql, /WHERE r\.id = \$1/);
  assert.match(sql, /LIMIT 1/);
  assert.doesNotMatch(sql, /abc-123/, "the id must not be interpolated into the SQL");
});

test("unknown report: the lookup can return at most one row, so a miss maps to null", () => {
  // getPaleReport does `rows[0] ? mapReport(rows[0]) : null`. That is only sound because
  // the query is bounded to a single row — this pins the property the null path relies on.
  const { sql, params } = buildReportQuery("does-not-exist");
  assert.match(sql, /LIMIT 1/);
  assert.equal(params.length, 1, "an unknown id is still a single bound parameter");
  assert.doesNotMatch(sql, /OR\b/i, "no widening predicate may make a miss match something else");
});

test("list and detail apply IDENTICAL scoping — they can never diverge", () => {
  /**
   * The Pale schema exposes no tenant, organization or workspace column; this was verified
   * across every pale query in the tree. `reports` is product-global and the console is a
   * staff surface, so there is no scope to filter on and lookup by primary key is the
   * established contract rather than an exception to it.
   *
   * This test does not assert "no scoping is correct" — it asserts the two readers agree.
   * If Pale later gains a tenant column and someone scopes the list but forgets the detail
   * read, that asymmetry is the actual cross-tenant leak, and this fails.
   */
  const SCOPE_COLUMNS = ["tenant_id", "tenantid", "org_id", "organization_id", "workspace_id"];
  const list = buildReportsQuery().sql;
  const detail = buildReportQuery("x").sql;
  for (const col of SCOPE_COLUMNS) {
    assert.equal(
      list.includes(col),
      detail.includes(col),
      `scoping on ${col} must be applied to BOTH the list and the detail read, or neither`,
    );
  }
  // Both must read the same relation through the same join, so a row visible in one is
  // visible in the other.
  assert.ok(list.includes("FROM reports r"), "list reads reports");
  assert.ok(detail.includes("FROM reports r"), "detail reads reports");
});
