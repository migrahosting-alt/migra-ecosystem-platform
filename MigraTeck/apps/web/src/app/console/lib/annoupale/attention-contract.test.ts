import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveAttention, type AttentionInput } from "./attention-contract.ts";

const base: AttentionInput = {
  complianceConnected: true,
  urgent: 0,
  high: 0,
  oldestOpen: null,
  appealsConnected: true,
  appealsWaiting: 0,
  unavailableSections: [],
};

test("deriveAttention: all clear -> healthy, no items", () => {
  const r = deriveAttention(base);
  assert.equal(r.items.length, 0);
  assert.equal(r.unavailableSections.length, 0);
  assert.equal(r.healthy, true);
});

test("deriveAttention: urgent + high + waiting + oldest produce items", () => {
  const r = deriveAttention({
    ...base,
    urgent: 2,
    high: 3,
    appealsWaiting: 1,
    oldestOpen: { caseId: "AP-9", ageDays: 10 },
  });
  const ids = r.items.map((i) => i.id);
  assert.deepEqual(ids, ["urgent", "high", "appeals-waiting", "oldest-open"]);
  assert.equal(r.items.find((i) => i.id === "urgent")?.severity, "critical");
  assert.equal(r.items.find((i) => i.id === "oldest-open")?.severity, "warning"); // >= 7 days
  assert.equal(r.healthy, false);
});

test("deriveAttention: oldest-open severity is info when fresh (<7d)", () => {
  const r = deriveAttention({ ...base, oldestOpen: { caseId: "AP-1", ageDays: 2 } });
  assert.equal(r.items[0].id, "oldest-open");
  assert.equal(r.items[0].severity, "info");
  assert.match(r.items[0].href ?? "", /\/console\/annoupale\/compliance\/AP-1$/);
});

test("deriveAttention: disconnected sections contribute no fabricated items", () => {
  const r = deriveAttention({
    ...base,
    complianceConnected: false,
    urgent: 5, // ignored because not connected
    high: 5,
    appealsConnected: false,
    appealsWaiting: 9,
    unavailableSections: ["Compliance", "Appeals"],
  });
  assert.equal(r.items.length, 0); // no items invented from unavailable sections
  assert.deepEqual(r.unavailableSections, ["Compliance", "Appeals"]);
  assert.equal(r.healthy, false); // unavailable => not healthy
});
