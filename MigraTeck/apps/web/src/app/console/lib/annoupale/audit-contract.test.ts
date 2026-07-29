import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseAuditEnvelope,
  filterAuditEvents,
  distinctActors,
  isComplianceCaseTarget,
  complianceCaseHref,
  AUDIT_ACTION_FILTERS,
  type AuditEventRow,
} from "./audit-contract.ts";

test("parseAuditEnvelope: maps rows and DROPS ipHash + metadata", () => {
  const r = parseAuditEnvelope({
    items: [
      {
        id: "e1",
        actorUserId: "1234567890abcdef",
        actorRole: "trust_safety_admin",
        actionType: "compliance.case.updated",
        targetType: "compliance_case",
        targetId: "abcdef1234",
        ipHash: "SHOULD_NOT_APPEAR",
        metadata: { secret: "SHOULD_NOT_APPEAR" },
        createdAt: "2026-06-06T00:00:00Z",
      },
    ],
    hasMore: false,
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const row = r.data.items[0];
  assert.equal(row.actor, "trust_safety_admin");
  assert.equal(row.actionType, "compliance.case.updated");
  assert.equal(row.targetType, "compliance_case");
  // targetId is truncated
  assert.equal(row.targetId, "abcdef12…");
  // serialized row must not carry ipHash / metadata
  const json = JSON.stringify(row);
  assert.equal(json.includes("SHOULD_NOT_APPEAR"), false);
  assert.equal(json.includes("ipHash"), false);
  assert.equal(json.includes("metadata"), false);
});

test("parseAuditEnvelope: actor falls back to short id then system", () => {
  const r = parseAuditEnvelope({
    items: [
      { id: "e1", actorUserId: "abcdefghম২", actionType: "x" },
      { id: "e2", actionType: "y" },
    ],
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.data.items[0].actor.endsWith("…"), true);
  assert.equal(r.data.items[1].actor, "system");
});

test("parseAuditEnvelope: rejects bad payloads", () => {
  assert.equal(parseAuditEnvelope({}).ok, false);
  assert.equal(parseAuditEnvelope({ items: 5 }).ok, false);
});

test("parseAuditEnvelope: targetRef full only for compliance-case targets", () => {
  const r = parseAuditEnvelope({
    items: [
      { id: "c", actionType: "compliance.case.updated", targetType: "compliance_case", targetId: "case123456789" },
      { id: "u", actionType: "auth.session.refreshed", targetType: "user", targetId: "user987654321" },
    ],
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.data.items[0].targetRef, "case123456789"); // full, for deep-link
  assert.equal(r.data.items[0].targetId, "case1234…"); // still truncated for display
  assert.equal(r.data.items[1].targetRef, ""); // non-case: no full id surfaced
});

test("isComplianceCaseTarget: matches case-ish target types only", () => {
  for (const t of ["compliance_case", "compliance.case", "ComplianceCase", "case"]) {
    assert.equal(isComplianceCaseTarget(t), true, t);
  }
  for (const t of ["user", "appeal", "moderation_report", "", "showcase"]) {
    assert.equal(isComplianceCaseTarget(t), false, t);
  }
});

test("complianceCaseHref: builds a safe console link or null", () => {
  assert.equal(complianceCaseHref("AP-123"), "/console/annoupale/compliance/AP-123");
  assert.equal(complianceCaseHref("a/b?c"), "/console/annoupale/compliance/a%2Fb%3Fc");
  assert.equal(complianceCaseHref(""), null);
});

test("AUDIT_ACTION_FILTERS: includes the required staff actions + all", () => {
  const values = AUDIT_ACTION_FILTERS.map((f) => f.value);
  for (const v of [
    "all",
    "staff_token_exchange",
    "compliance.case.note_added",
    "compliance.case.updated",
    "compliance.case.closed",
    "auth.session.refreshed",
  ]) {
    assert.equal(values.includes(v as (typeof values)[number]), true, v);
  }
});

const sample: AuditEventRow[] = [
  { id: "1", actor: "trust_safety_admin", actionType: "compliance.case.closed", targetType: "compliance_case", targetId: "abc12345…", targetRef: "abc123456", createdAt: "2026-06-06T10:00:00Z" },
  { id: "2", actor: "moderator", actionType: "compliance.case.note_added", targetType: "compliance_case", targetId: "def67890…", targetRef: "def678901", createdAt: "2026-06-06T09:00:00Z" },
  { id: "3", actor: "trust_safety_admin", actionType: "auth.session.refreshed", targetType: "user", targetId: "ghi11111…", targetRef: "", createdAt: "2026-06-06T08:00:00Z" },
];

test("filterAuditEvents: action filter ('all' passes through)", () => {
  assert.equal(filterAuditEvents(sample, { action: "all" }).length, 3);
  const closed = filterAuditEvents(sample, { action: "compliance.case.closed" });
  assert.equal(closed.length, 1);
  assert.equal(closed[0].id, "1");
});

test("filterAuditEvents: actor filter", () => {
  const a = filterAuditEvents(sample, { actor: "trust_safety_admin" });
  assert.deepEqual(a.map((e) => e.id), ["1", "3"]);
});

test("filterAuditEvents: target free-text matches type/id (case-insensitive)", () => {
  assert.equal(filterAuditEvents(sample, { target: "USER" }).length, 1);
  assert.equal(filterAuditEvents(sample, { target: "def678" }).length, 1); // matches targetRef
  assert.equal(filterAuditEvents(sample, { target: "nomatch" }).length, 0);
});

test("filterAuditEvents: combined filters AND together, order preserved", () => {
  const r = filterAuditEvents(sample, { action: "compliance.case.note_added", actor: "moderator" });
  assert.deepEqual(r.map((e) => e.id), ["2"]);
});

test("distinctActors: unique + sorted", () => {
  assert.deepEqual(distinctActors(sample), ["moderator", "trust_safety_admin"]);
});
