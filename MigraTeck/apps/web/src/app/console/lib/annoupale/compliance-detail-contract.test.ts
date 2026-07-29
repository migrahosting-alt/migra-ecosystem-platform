import { test } from "node:test";
import assert from "node:assert/strict";
import { parseComplianceCaseDetail, deriveCaseTimeline } from "./compliance-detail-contract.ts";

const baseCase = {
  id: "uuid-1",
  publicCaseId: "AP-SEC-001",
  category: "security",
  requestType: "vulnerability",
  priority: "high",
  severity: "high",
  status: "open",
  sourceRoute: "/security/report",
  requesterName: "Reporter",
  requesterEmail: "reporter@example.com",
  requesterHandle: "@rep",
  requesterUserId: "user-9",
  targetUserHandle: null,
  targetUrl: "https://annoupale.com/x",
  details: "steps to reproduce",
  assignedTo: null,
  actionTaken: null,
  internalNotes: "staff note",
  metadata: { vulnerabilityType: "xss", impact: "high", attorneyReviewRequired: true, urgency: "immediate_danger" },
  createdAt: "2026-06-01T10:00:00.000Z",
  updatedAt: "2026-06-02T10:00:00.000Z",
  closedAt: null,
};

test("parses a full case and maps the staff detail shape", () => {
  const r = parseComplianceCaseDetail(baseCase);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const d = r.detail;
  assert.equal(d.caseId, "AP-SEC-001");
  assert.equal(d.category, "security");
  assert.equal(d.requester.email, "reporter@example.com"); // staff detail surfaces requester
  assert.equal(d.details, "steps to reproduce");
  assert.equal(d.internal.internalNotes, "staff note");
});

test("derives risk flags from heterogeneous signals", () => {
  const r = parseComplianceCaseDetail(baseCase);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  // security category -> securityIssue; metadata urgency -> immediateDanger;
  // metadata.attorneyReviewRequired -> attorneyReviewRequired
  assert.equal(r.detail.riskFlags.securityIssue, true);
  assert.equal(r.detail.riskFlags.immediateDanger, true);
  assert.equal(r.detail.riskFlags.attorneyReviewRequired, true);
  assert.equal(r.detail.riskFlags.childSafety, false);
  assert.equal(r.detail.riskFlags.underage, false);
});

test("child_safety / underage request types flip the right flags", () => {
  const cs = parseComplianceCaseDetail({ ...baseCase, category: "safety", requestType: "child_safety", metadata: {} });
  assert.equal(cs.ok, true);
  if (cs.ok) {
    assert.equal(cs.detail.riskFlags.childSafety, true);
    assert.equal(cs.detail.riskFlags.securityIssue, false);
    assert.equal(cs.detail.riskFlags.immediateDanger, false);
  }
  const un = parseComplianceCaseDetail({ ...baseCase, category: "safety", requestType: "underage", metadata: {} });
  if (un.ok) assert.equal(un.detail.riskFlags.underage, true);
});

test("metadata surfacing hides flag-derived keys, keeps primitive context, drops nested", () => {
  const r = parseComplianceCaseDetail({
    ...baseCase,
    metadata: { vulnerabilityType: "xss", urgency: "immediate_danger", attorneyReviewRequired: true, nested: { a: 1 }, list: [1, 2] },
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const keys = r.detail.metadata.map((m) => m.key);
  assert.ok(keys.includes("vulnerabilityType"));
  assert.equal(keys.includes("urgency"), false); // surfaced as flag
  assert.equal(keys.includes("attorneyReviewRequired"), false); // surfaced as flag
  assert.equal(keys.includes("nested"), false); // object dropped
  assert.equal(keys.includes("list"), false); // array dropped
});

test("defensive defaults for missing optional fields", () => {
  const r = parseComplianceCaseDetail({ id: "uuid-2" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.detail.caseId, "uuid-2"); // falls back to id
  assert.equal(r.detail.category, "—");
  assert.equal(r.detail.requester.email, "—");
  assert.equal(r.detail.details, "");
  assert.deepEqual(r.detail.metadata, []);
  assert.equal(r.detail.riskFlags.securityIssue, false);
});

test("rejects malformed payloads (contract gate)", () => {
  assert.equal(parseComplianceCaseDetail(null).ok, false);
  assert.equal(parseComplianceCaseDetail({}).ok, false); // no id
  assert.equal(parseComplianceCaseDetail("nope").ok, false);
  assert.equal(parseComplianceCaseDetail({ id: 123 }).ok, false); // id not string
});

test("deriveCaseTimeline: created only when nothing else present", () => {
  const t = deriveCaseTimeline({
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "",
    closedAt: "",
    internal: { assignedTo: "—", actionTaken: "—", internalNotes: "" },
  });
  assert.deepEqual(t.map((e) => e.kind), ["created"]);
  assert.equal(t[0].at, "2026-06-01T00:00:00Z");
});

test("deriveCaseTimeline: full lifecycle in order, note has no fabricated time", () => {
  const t = deriveCaseTimeline({
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-03T00:00:00Z",
    closedAt: "2026-06-04T00:00:00Z",
    internal: { assignedTo: "x", actionTaken: "y", internalNotes: "looked into it" },
  });
  assert.deepEqual(t.map((e) => e.kind), ["created", "note", "updated", "closed"]);
  const note = t.find((e) => e.kind === "note");
  assert.equal(note?.at, ""); // no per-note timestamp invented
  assert.equal(t.find((e) => e.kind === "closed")?.at, "2026-06-04T00:00:00Z");
});

test("deriveCaseTimeline: omits 'updated' when equal to created; omits empty fields", () => {
  const t = deriveCaseTimeline({
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    closedAt: "",
    internal: { assignedTo: "—", actionTaken: "—", internalNotes: "   " },
  });
  assert.deepEqual(t.map((e) => e.kind), ["created"]); // no updated (== created), no note (blank)
});
