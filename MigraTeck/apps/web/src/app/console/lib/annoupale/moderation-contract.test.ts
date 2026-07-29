import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseModerationEnvelope,
  sanitizeModerationStatus,
} from "./moderation-contract.ts";

test("parseModerationEnvelope: maps rows and derives rollups", () => {
  const r = parseModerationEnvelope({
    cases: [
      { id: "a", status: "open", priority: "high", targetType: "user", targetId: "u1", riskScore: 80, openedAt: "2026-06-01T00:00:00Z" },
      { id: "b", status: "assigned", priority: "critical", targetType: "post", targetId: "p2", riskScore: 50 },
      { id: "c", status: "closed", priority: "low", targetType: "group" },
    ],
    hasMore: true,
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.data.cases.length, 3);
  assert.equal(r.data.summary.pending, 2); // open + assigned
  assert.equal(r.data.summary.highPriority, 2); // high + critical
  assert.equal(r.data.summary.total, 3);
  assert.equal(r.data.hasMore, true);
  // riskScore defaults to 0 when absent
  assert.equal(r.data.cases[2].riskScore, 0);
});

test("parseModerationEnvelope: rejects non-conforming payloads", () => {
  assert.equal(parseModerationEnvelope({}).ok, false);
  assert.equal(parseModerationEnvelope({ cases: "nope" }).ok, false);
  assert.equal(parseModerationEnvelope(null).ok, false);
});

test("sanitizeModerationStatus: whitelist only", () => {
  assert.equal(sanitizeModerationStatus("open"), "open");
  assert.equal(sanitizeModerationStatus("assigned"), "assigned");
  assert.equal(sanitizeModerationStatus("bogus"), undefined);
  assert.equal(sanitizeModerationStatus(undefined), undefined);
});
