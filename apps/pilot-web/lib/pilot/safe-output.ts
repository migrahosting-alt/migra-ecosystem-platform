// MigraPilot — safe-read response helper (Phase 12.9).
//
// Wraps copy-facing SAFE-READ payloads (reports / journal reads / diagnostics) through the tested
// `redactPilotValue` (Phase 12.7) so secrets never reach the UI/clipboard, consistently and as
// defense-in-depth on top of the existing per-module sanitizers. READ-ONLY: changes no logic, no
// control flow, no eligibility/approval/hashing — it only redacts the final response body.
//
// Do NOT use on code/source/prompt payloads (would corrupt legitimate text), on approval-hash inputs,
// or on eligibility/target-fingerprint evaluation.

import { redactPilotValue } from "./redaction";

export function redactPilotOutput<T>(payload: T): unknown {
  return redactPilotValue(payload);
}

export function safeJson(payload: unknown, init?: ResponseInit): Response {
  return Response.json(redactPilotValue(payload), init);
}
