import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseComplianceEnvelope,
  reasonLabel,
  sanitizeCategory,
  sanitizePage,
  sanitizePriority,
  sanitizeStatus,
  isLikelyCaseId,
} from "./compliance-contract.ts";

const validEnvelope = {
  cases: [
    {
      id: "uuid-1",
      publicCaseId: "AP-PRV-001",
      category: "privacy",
      requestType: "data_export",
      priority: "high",
      severity: "medium",
      status: "open",
      assignedTo: "agent-1",
      createdAt: "2026-06-01T10:00:00.000Z",
      // PII the API includes but the queue must NOT surface:
      requesterEmail: "victim@example.com",
      requesterHandle: "@victim",
    },
  ],
  total: 1,
  page: 1,
  limit: 25,
  summary: { open: 3, urgent: 1, high: 2, waiting: 1, closed: 9 },
};

test("parses a valid envelope and maps safe rows", () => {
  const r = parseComplianceEnvelope(validEnvelope);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.data.total, 1);
  assert.deepEqual(r.data.summary, { open: 3, urgent: 1, high: 2, waiting: 1, closed: 9 });
  const row = r.data.cases[0]!;
  assert.equal(row.caseId, "AP-PRV-001");
  assert.equal(row.category, "privacy");
  assert.equal(row.status, "open");
});

test("NEVER surfaces requester PII in mapped rows", () => {
  const r = parseComplianceEnvelope(validEnvelope);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const row = r.data.cases[0]!;
  const serialized = JSON.stringify(row);
  assert.equal(serialized.includes("victim@example.com"), false);
  assert.equal(serialized.includes("@victim"), false);
  assert.equal("requesterEmail" in row, false);
  assert.equal("requesterHandle" in row, false);
});

test("falls back to id when publicCaseId is missing, dashes for empty fields", () => {
  const r = parseComplianceEnvelope({
    cases: [{ id: "uuid-2", status: "closed" }],
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const row = r.data.cases[0]!;
  assert.equal(row.caseId, "uuid-2");
  assert.equal(row.category, "—");
  assert.equal(row.requestType, "—");
  assert.equal(row.assignedTo, "");
  assert.equal(row.createdAt, "");
});

test("defaults summary to zeros when absent", () => {
  const r = parseComplianceEnvelope({ cases: [] });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.data.summary, { open: 0, urgent: 0, high: 0, waiting: 0, closed: 0 });
  assert.equal(r.data.total, 0);
  assert.equal(r.data.page, 1);
});

test("rejects malformed payloads (contract gate)", () => {
  assert.equal(parseComplianceEnvelope(null).ok, false);
  assert.equal(parseComplianceEnvelope({}).ok, false); // no cases
  assert.equal(parseComplianceEnvelope({ cases: "nope" }).ok, false);
  assert.equal(parseComplianceEnvelope({ cases: [{ noId: true }] }).ok, false);
  assert.equal(parseComplianceEnvelope("string").ok, false);
});

test("filter sanitizers whitelist enum values", () => {
  assert.equal(sanitizeStatus("open"), "open");
  assert.equal(sanitizeStatus("DROP TABLE"), undefined);
  assert.equal(sanitizeCategory("privacy"), "privacy");
  assert.equal(sanitizeCategory("hacky"), undefined);
  assert.equal(sanitizePriority("urgent"), "urgent");
  assert.equal(sanitizePriority("xxx"), undefined);
  assert.equal(sanitizePage("3"), 3);
  assert.equal(sanitizePage("0"), 1);
  assert.equal(sanitizePage("abc"), 1);
  assert.equal(sanitizePage(undefined), 1);
});

test("reasonLabel returns a non-leaky string for every reason", () => {
  for (const reason of [
    "no_session",
    "missing_env",
    "denied",
    "rate_limited",
    "bridge_unavailable",
    "upstream_error",
    "contract_mismatch",
  ] as const) {
    const s = reasonLabel(reason);
    assert.equal(typeof s, "string");
    assert.ok(s.length > 0);
  }
});

test("isLikelyCaseId: accepts dash-delimited ids / UUIDs, rejects names/handles/emails", () => {
  // looks like a case id
  assert.equal(isLikelyCaseId("AP-SEC-001"), true);
  assert.equal(isLikelyCaseId("3f8a1c2e-1111-2222-3333-444455556666"), true);
  // not a case id
  assert.equal(isLikelyCaseId("john smith"), false); // whitespace
  assert.equal(isLikelyCaseId("reporter@example.com"), false); // email
  assert.equal(isLikelyCaseId("@rep"), false); // handle
  assert.equal(isLikelyCaseId("open"), false); // no dash, too short-ish
  assert.equal(isLikelyCaseId(""), false);
  assert.equal(isLikelyCaseId(undefined), false);
});
