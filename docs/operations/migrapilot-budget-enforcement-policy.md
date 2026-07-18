# MigraPilot Budget Enforcement Policy

© MigraTeck LLC. Internal operational document.

## Contract

No paid cloud request may begin without a successful, atomic budget **reservation**.
Enforcement is server-authoritative; the client may request a policy or read budget
state, but can never choose, increase, or bypass a limit.

```
estimate → identify scopes → reserve → authorize/deny → execute →
reconcile actual → release/adjust → audit
```

## Scopes

`per_request` · `daily` · `monthly` · `provider` · `model` · `workspace_or_tenant`.
Each: enabled, currency, hard limit, warning threshold, rolling period, spent,
reserved, remaining (= limit − spent − reserved).

## Hard limits fail closed

Denial codes: `BUDGET_DISABLED`, `BUDGET_NOT_CONFIGURED`, `BUDGET_EXCEEDED`,
`REQUEST_COST_LIMIT_EXCEEDED`, `PROVIDER_COST_LIMIT_EXCEEDED`,
`COST_ESTIMATE_UNAVAILABLE`, `RESERVATION_CONFLICT`.

Rules:
- `local-only` and privacy policies remain cloud-incapable regardless of budget.
- A privacy/consent denial is never overridden by available budget.
- An enabled cloud provider without trustworthy pricing must not execute.
- A warning is never sufficient once a hard limit is reached. No best-effort overspend.

## Reservation invariants

Two concurrent requests cannot both spend the same remaining budget (the check +
reserved-increment run in one synchronous critical section). Reserved funds count
against remaining. A failed call releases its reservation. Actual usage reconciles
against the reservation (floored ≥ 0; overrun surfaced). A consumed/released
reservation cannot be reused — replays/retries need a fresh reservation. Expired
reservations auto-release audibly. **Telemetry/audit failure never weakens
enforcement** — the reservation path is independent of them.

## Warning thresholds

At the configured threshold: `budget.warning_threshold_reached` (informational).
At the limit: `budget.hard_limit_reached`. Unexplained overrun / reconciliation
mismatch: high severity. An accounting inconsistency that could permit overspend:
critical and fail closed.

## Configuration (env)

`MIGRAPILOT_BUDGET_ENABLED` (default false → cloud denied), `..._PER_REQUEST_USD`,
`..._DAILY_USD`, `..._MONTHLY_USD`, `..._PROVIDER_{OPENAI,ANTHROPIC}_USD`,
`..._WARNING_THRESHOLD`. Budget configuration mutation is out of scope for this
slice (env / server-side only).

## Emergency cloud-spend disable

Set `MIGRAPILOT_BUDGET_ENABLED=false` (or unset the limits) and restart — every
paid cloud request then fails closed (`BUDGET_DISABLED` / `BUDGET_NOT_CONFIGURED`).
Disabling the cloud provider entirely also blocks escalation.

## Prohibited bypasses

No client-raised limits, no overspend to "finish" a task, no execution on unknown
pricing, no silencing a reconciliation mismatch and continuing.
