# MigraPilot Cloud Cost — Incident Response

© MigraTeck LLC. Internal operational document.

## Scope

Responding to budget/cost anomalies. Cloud spend is only ever reachable through the
approval-gated escalation flow with an atomic reservation — so runaway spend is
structurally prevented. This runbook covers the exceptions.

## Signals (audit events)

`budget.warning_threshold_reached` (informational) · `budget.hard_limit_reached`
(warning) · repeated `budget.reservation_denied` / `budget.reservation_pressure`
(warning) · `budget.overrun_detected` / `budget.reconciliation_mismatch` (HIGH) ·
an accounting inconsistency that could permit overspend (CRITICAL — fail closed).

## Response

1. **Warning threshold reached** — review recent cloud usage
   (`GET /api/ai/providers/usage?localOrCloud=cloud`) + budget status
   (`GET /api/ai/providers/budget`). No action required unless spend is unexpected.
2. **Hard limit reached** — cloud escalation is already fail-closed. Decide whether
   to raise the limit (owner action, out of band) or leave it enforced.
3. **Overrun / reconciliation mismatch (HIGH)** — the provider-reported cost
   diverged from the calculated cost, or actual exceeded the reservation. Inspect
   the ledger record's `providerReportedCostUsd` vs `calculatedCostUsd`. Do not
   silence it and continue. Verify the pricing record is correct.
4. **Accounting inconsistency (CRITICAL)** — if the system cannot guarantee it
   won't overspend, DISABLE cloud spend immediately (below) and escalate to the owner.

## Emergency cloud-spend disable

Set `MIGRAPILOT_BUDGET_ENABLED=false` (or clear the limits) and restart — every
paid request fails closed. Disabling the cloud provider
(`MIGRAPILOT_PROVIDER_ANTHROPIC_ENABLED=false`) also blocks escalation entirely.

## Stop conditions

- Never raise a limit to "finish" an in-flight task.
- Never execute under `estimated`/`unknown` pricing.
- Never suppress an overrun or reconciliation-mismatch and continue.
- Never store prompts/responses/secrets in the ledger to "debug" a cost.

## Escalation path

Reconciliation mismatch that suggests a pricing error, or any inconsistency that
could permit overspend → disable cloud spend, preserve the audit chain, escalate to
the owner. Production delegation remains a separate, disabled program.
