# MigraPilot Intelligent Provider Router — Escalation & Consent (Slice 3)

© MigraTeck LLC. Internal operational document.

## Purpose

The first slice where a cloud attempt may run — never as a generic "local failed →
call cloud" switch. Escalation is **classified, gated, consented, attributed, and
audited**, and runs at most **one** cloud attempt.

## Pipeline

```
local execution
→ bounded failure classification (defined reasons only)
→ policy evaluation
→ privacy + consent check
→ budget + provider eligibility check
→ explicit escalation decision (a single-use OFFER)
→ ONE approved cloud attempt (separate /escalation/approve call)
→ truthful, attributed final result
```

## Defined escalation reasons (only these qualify)

`LOCAL_TIMEOUT` · `LOCAL_MALFORMED_OUTPUT` · `LOCAL_CONTEXT_LIMIT` ·
`LOCAL_UNSUPPORTED_CAPABILITY`. A valid-but-imperfect local result **never**
qualifies.

## Impossibility conditions (fail-closed)

Escalation is **impossible** — no offer is ever minted — when:

- the policy is `local-only` or `privacy-first` (prohibit external transfer);
- no defined reason applies;
- no eligible cloud provider (enabled + credentialed + reachable + default model +
  required capabilities);
- the estimated cost exceeds `MIGRAPILOT_CLOUD_MAX_COST_PER_REQUEST_USD`.

## Two-step, approval-gated consent

1. A local coding failure with a defined reason mints a **single-use OFFER**
   (`offerId` + `token`, bound to a hash of the request, TTL 5 min). **No cloud
   call happens here.** The engineer surface returns/streams an `escalationOffer`;
   the chat surface returns `LOCAL_COMPLETION_FAILED` + `escalationOffer`.
2. `POST /api/ai/escalation/approve { offerId, token, request }` is the **only**
   path that runs a cloud attempt. It consumes the offer (replay/expiry/mismatch
   refused), **re-validates** the target is still eligible, then runs **exactly
   one** attributed cloud completion. No retry, no failover, no queueing.

## Attribution + audit

Every result carries `{ provider, model, reason, viaEscalation: true }`. Audit
chain: `escalation.offered` / `escalation.denied` / `escalation.approved` /
`escalation.attempted` / `escalation.completed` / `escalation.failed` — safe
metadata only; the credential value is never logged or surfaced.

## Failure / denial codes

Offer: `deniedReason` (no reason / prohibits external / no eligible cloud / over
budget). Approve: `400 BAD_REQUEST`, `409 OFFER_INVALID` (unknown / replayed /
expired / token or request mismatch), `403 TARGET_INELIGIBLE` / `UNKNOWN_TARGET`,
`502 ESCALATION_FAILED` (the one attempt failed; sanitized error).

## Configuration

- `MIGRAPILOT_CLOUD_MAX_COST_PER_REQUEST_USD` — per-request cloud budget cap
  (default 1.0). Full budget governance is Slice 4.
- `MIGRAPILOT_CLOUD_{OPENAI,ANTHROPIC}_MODEL` — escalation target model per cloud
  provider. Cloud providers remain disabled by default.

## Invariants (tested)

- No cloud attempt runs without a consumed offer (no silent cloud).
- The coding surfaces + control plane OFFER only; the single sanctioned executor
  is the only code that completes to cloud (source scan).
- Escalation impossible under every external-prohibiting policy, for every reason.
- Exactly one attempt; failure does not retry; errors sanitized.
- Target re-validated at approval time.

## Stop conditions / escalation

- Never widen a policy or enable a provider to "unblock" an escalation.
- A credential value observed anywhere → security incident; disable the cloud
  provider and escalate to the owner. Production delegation remains separate +
  disabled.
