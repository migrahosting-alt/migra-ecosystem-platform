# MigraPilot — Cloud Escalation UX

© MigraTeck LLC.

## Principle

Cloud is the **last resort**. It is reached only through an explicit, consented,
budget-gated escalation after the local engine is insufficient. **Nothing is
approved silently.**

## The consent surface

When the server issues a valid escalation offer, the extension shows a **modal**
consent dialog built verbatim from the server offer:

```
Cloud fallback requested
Reason: <defined reason>
Provider: <provider>
Model: <approved model>
Data leaving this device: current prompt and selected workspace context
Estimated cost: $0.03 (estimated)
Worst-case cost: $0.07 (estimated)
Remaining budget: $18.42
```

Actions: **Approve once** · **Stay local** (Decline). Only *Approve once* submits
the server-issued offer reference for exactly one cloud call. Stay local / dismiss
/ a malformed or expired offer → **zero cloud calls**.

## What the client may submit

ONLY `{ offerId, token, request }`. The client never reconstructs or modifies the
provider, model, escalation reason, cost ceiling, privacy classification, or
data-transfer scope. Consent binds the server's worst-case cost ceiling.

## Failure + stale states

Approval failures surface the server code with a clear message (e.g.
`BUDGET_EXCEEDED`, `CEILING_EXCEEDED`, `TARGET_INELIGIBLE`). An expired offer shows
"This cloud offer expired. Request a new evaluation." — it is not actionable, and
there is **no hidden retry**.
