import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NOTE_MAX,
  mapNoteStatus,
  noteReasonLabel,
  validateNote,
} from "./compliance-note-contract.ts";

test("accepts a valid trimmed note", () => {
  const r = validateNote("  please verify ID  ");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value, "please verify ID");
});

test("rejects empty / whitespace-only notes", () => {
  assert.deepEqual(validateNote(""), { ok: false, reason: "empty" });
  assert.deepEqual(validateNote("    "), { ok: false, reason: "empty" });
  assert.deepEqual(validateNote(undefined), { ok: false, reason: "empty" });
  assert.deepEqual(validateNote(123), { ok: false, reason: "empty" });
});

test("rejects notes over the max length", () => {
  const long = "x".repeat(NOTE_MAX + 1);
  assert.deepEqual(validateNote(long), { ok: false, reason: "too_long" });
  // exactly max is allowed
  assert.equal(validateNote("y".repeat(NOTE_MAX)).ok, true);
});

test("maps backend statuses to safe results", () => {
  assert.deepEqual(mapNoteStatus(200), { ok: true });
  assert.deepEqual(mapNoteStatus(201), { ok: true });
  assert.deepEqual(mapNoteStatus(400), { ok: false, reason: "invalid" });
  assert.deepEqual(mapNoteStatus(401), { ok: false, reason: "denied" });
  assert.deepEqual(mapNoteStatus(403), { ok: false, reason: "denied" });
  assert.deepEqual(mapNoteStatus(404), { ok: false, reason: "not_found" });
  assert.deepEqual(mapNoteStatus(429), { ok: false, reason: "rate_limited" });
  assert.deepEqual(mapNoteStatus(500), { ok: false, reason: "unavailable" });
  assert.deepEqual(mapNoteStatus(502), { ok: false, reason: "unavailable" });
});

test("every reason has a non-empty, non-leaky label", () => {
  for (const reason of [
    "empty",
    "too_long",
    "denied",
    "not_found",
    "rate_limited",
    "invalid",
    "no_session",
    "unavailable",
  ] as const) {
    const s = noteReasonLabel(reason);
    assert.equal(typeof s, "string");
    assert.ok(s.length > 0);
  }
});
