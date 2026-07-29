import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RESOLUTION_MAX,
  SETTABLE_STATUSES,
  isSettableStatus,
  mapStatusHttp,
  statusReasonLabel,
  validateClose,
  validateStatusChange,
} from "./compliance-status-contract.ts";

test("settable statuses exclude 'closed' (close is gated separately)", () => {
  assert.equal(SETTABLE_STATUSES.includes("closed"), false);
  assert.equal(isSettableStatus("investigating"), true);
  assert.equal(isSettableStatus("closed"), false);
  assert.equal(isSettableStatus("nonsense"), false);
});

test("status change validation", () => {
  assert.deepEqual(validateStatusChange("escalated"), { ok: true });
  assert.deepEqual(validateStatusChange("closed"), { ok: false, reason: "invalid_status" });
  assert.deepEqual(validateStatusChange("zzz"), { ok: false, reason: "invalid_status" });
  assert.deepEqual(validateStatusChange(undefined), { ok: false, reason: "invalid_status" });
});

test("close requires confirmation AND non-empty resolution", () => {
  // not confirmed
  assert.deepEqual(validateClose("done", false), { ok: false, reason: "not_confirmed" });
  // confirmed but empty / whitespace
  assert.deepEqual(validateClose("", true), { ok: false, reason: "resolution_required" });
  assert.deepEqual(validateClose("   ", true), { ok: false, reason: "resolution_required" });
  assert.deepEqual(validateClose(undefined, true), { ok: false, reason: "resolution_required" });
  // too long
  assert.deepEqual(validateClose("x".repeat(RESOLUTION_MAX + 1), true), {
    ok: false,
    reason: "resolution_too_long",
  });
  // valid → trimmed resolution returned
  assert.deepEqual(validateClose("  resolved: verified + actioned  ", true), {
    ok: true,
    resolution: "resolved: verified + actioned",
  });
});

test("maps backend statuses to safe results", () => {
  assert.deepEqual(mapStatusHttp(200), { ok: true });
  assert.deepEqual(mapStatusHttp(201), { ok: true });
  assert.deepEqual(mapStatusHttp(400), { ok: false, reason: "invalid" });
  assert.deepEqual(mapStatusHttp(401), { ok: false, reason: "denied" });
  assert.deepEqual(mapStatusHttp(403), { ok: false, reason: "denied" });
  assert.deepEqual(mapStatusHttp(404), { ok: false, reason: "not_found" });
  assert.deepEqual(mapStatusHttp(429), { ok: false, reason: "rate_limited" });
  assert.deepEqual(mapStatusHttp(500), { ok: false, reason: "unavailable" });
});

test("every reason has a non-empty label", () => {
  for (const reason of [
    "invalid_status",
    "resolution_required",
    "resolution_too_long",
    "not_confirmed",
    "denied",
    "not_found",
    "rate_limited",
    "invalid",
    "no_session",
    "unavailable",
  ] as const) {
    const s = statusReasonLabel(reason);
    assert.equal(typeof s, "string");
    assert.ok(s.length > 0);
  }
});
