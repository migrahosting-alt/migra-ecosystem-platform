import { test } from "node:test";
import assert from "node:assert/strict";
import { parseComplianceEnvelope } from "./compliance-contract.ts";

// Appeals are compliance cases with category="appeal" returned by the same
// endpoint; these tests cover the appeals view's contract + PII safety.

const appealEnvelope = {
  cases: [
    {
      id: "uuid-ap-1",
      publicCaseId: "AP-APP-001",
      category: "appeal",
      requestType: "account_suspension",
      priority: "normal",
      severity: "—",
      status: "open",
      assignedTo: null,
      createdAt: "2026-06-02T09:00:00.000Z",
      // PII the API includes but the appeals list must NOT surface:
      requesterEmail: "appellant@example.com",
      requesterHandle: "@appellant",
    },
  ],
  total: 1,
  page: 1,
  limit: 25,
};

test("parses an appeal envelope and maps safe rows", () => {
  const r = parseComplianceEnvelope(appealEnvelope);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.data.total, 1);
  const row = r.data.cases[0]!;
  assert.equal(row.caseId, "AP-APP-001");
  assert.equal(row.category, "appeal");
  assert.equal(row.requestType, "account_suspension");
  assert.equal(row.status, "open");
});

test("NEVER surfaces appellant PII in mapped appeal rows", () => {
  const r = parseComplianceEnvelope(appealEnvelope);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const row = r.data.cases[0]!;
  const s = JSON.stringify(row);
  assert.equal(s.includes("appellant@example.com"), false);
  assert.equal(s.includes("@appellant"), false);
  assert.equal("requesterEmail" in row, false);
  assert.equal("requesterHandle" in row, false);
});

test("no fake data — empty appeals stays empty", () => {
  const r = parseComplianceEnvelope({ cases: [], total: 0, page: 1, limit: 25 });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.data.cases.length, 0);
  assert.equal(r.data.total, 0);
});

test("malformed appeals response → contract gate fails (fallback, no fake rows)", () => {
  assert.equal(parseComplianceEnvelope(null).ok, false);
  assert.equal(parseComplianceEnvelope({ cases: "nope" }).ok, false);
  assert.equal(parseComplianceEnvelope({ cases: [{ noId: true }] }).ok, false);
});
