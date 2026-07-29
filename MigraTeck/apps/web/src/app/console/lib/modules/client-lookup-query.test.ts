import assert from "node:assert/strict";
import test from "node:test";
import { buildClientByEmailQuery, CLIENT_EMAIL_SOURCE } from "./client-lookup-query.ts";

/**
 * Determinism tests for client-by-email resolution.
 *
 * The defect these guard against: the original query was `UNION ... LIMIT 1` with no
 * ORDER BY, so an address held by two tenants — one as its billing_email, another as a
 * hosted mailbox — resolved to whichever row the planner emitted first. Same input,
 * different customer, no error. In a Mail panel that shows billing and subscription
 * counts, that is the wrong customer's data.
 */

const q = (email: string) => buildClientByEmailQuery(email);

test("the precedence chain is total — three ordering keys, most significant first", () => {
  const { sql } = q("a@b.com")!;
  const order = /ORDER BY\s+source_rank ASC,\s+status_rank ASC,\s+id ASC/;
  assert.match(sql.replace(/\s+/g, " "), new RegExp(order.source.replace(/\\s\+/g, " ")));
  // The tiebreak is the point: without a stable final key the tie is still arbitrary.
  assert.match(sql, /id ASC/);
  assert.match(sql, /LIMIT 1/);
});

test("the account record outranks a hosted mailbox", () => {
  assert.ok(
    CLIENT_EMAIL_SOURCE.BILLING_EMAIL < CLIENT_EMAIL_SOURCE.MAILBOX,
    "billing_email must sort before mailbox",
  );
  const { sql } = q("a@b.com")!;
  const billingRank = sql.indexOf(`${CLIENT_EMAIL_SOURCE.BILLING_EMAIL} AS source_rank`);
  const mailboxRank = sql.indexOf(`${CLIENT_EMAIL_SOURCE.MAILBOX} AS source_rank`);
  assert.ok(billingRank > -1 && mailboxRank > -1, "both sources must be ranked");
  // The billing branch is also written first, so the SQL reads in precedence order.
  assert.ok(billingRank < mailboxRank);
});

test("SAME EMAIL IN BOTH SOURCES resolves deterministically to the account record", () => {
  // The exact collision that motivated the fix. Both branches match the one bound
  // parameter; source_rank decides, and it decides the same way every execution.
  const { sql, params } = q("shared@example.com")!;
  assert.deepEqual(params, ["shared@example.com"]);
  assert.equal((sql.match(/\$1/g) ?? []).length, 2, "one parameter feeds both branches");
  assert.ok(sql.indexOf("FROM tenants t") < sql.indexOf("FROM mailboxes m"));
  assert.match(sql, /ORDER BY source_rank ASC/);
});

test("UNION ALL, not UNION — dedup must not pre-empt the ordering", () => {
  // With rank columns the branches are no longer identical rows, so UNION would stop
  // collapsing them anyway; worse, relying on dedup would hide the tie the ORDER BY exists
  // to resolve.
  const { sql } = q("a@b.com")!;
  assert.match(sql, /UNION ALL/);
  assert.doesNotMatch(sql, /UNION(?!\s+ALL)/, "a bare UNION would reintroduce planner-order dependence");
});

test("active/current rows outrank inactive ones within a source", () => {
  const { sql } = q("a@b.com")!;
  // Canonical status convention, matching clients.ts elsewhere.
  assert.match(sql, /COALESCE\(t\.is_active, TRUE\)/);
  assert.match(sql, /COALESCE\(t\.status, 'active'\) = 'active'/);
  assert.match(sql, /COALESCE\(m\.status, 'active'\) = 'active'/);
  // 0 sorts before 1, and status_rank is ASC.
  assert.match(sql, /THEN 0 ELSE 1 END AS status_rank/);
});

test("the email is normalized once and always bound, never interpolated", () => {
  const { sql, params } = q("  MiXeD@Example.COM  ")!;
  assert.deepEqual(params, ["mixed@example.com"], "trimmed and lowercased");
  assert.doesNotMatch(sql, /example\.com/i, "the address must not reach the SQL text");
  // Both sides compare lowercased, so normalization on one side cannot desync the other.
  assert.match(sql, /LOWER\(COALESCE\(t\.billing_email, ''\)\) = \$1/);
  assert.match(sql, /LOWER\(m\.address\) = \$1/);
});

test("a mailbox with no tenant can never resolve to a customer", () => {
  const { sql } = q("a@b.com")!;
  assert.match(sql, /m\.tenantid IS NOT NULL/);
});

test("input that cannot identify a customer returns null instead of querying", () => {
  for (const bad of ["", "   ", "noatsign", "@leading.com", "trailing@", "\t\n"]) {
    assert.equal(q(bad), null, `must not build a query for ${JSON.stringify(bad)}`);
  }
  assert.equal(buildClientByEmailQuery(undefined as unknown as string), null);
});

test("the same input always produces byte-identical SQL and parameters", () => {
  // Determinism at the construction layer as well as the ordering layer.
  const a = q("repeat@example.com")!;
  const b = q("REPEAT@example.com  ")!;
  assert.equal(a.sql, b.sql);
  assert.deepEqual(a.params, b.params);
});
