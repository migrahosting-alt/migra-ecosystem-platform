# MigraPilot Production Diagnostics — Incident Response

© MigraTeck LLC. Internal operational document.

Diagnostics are read-only, so they cannot themselves damage production. This
runbook covers responding to what a diagnostic REVEALS, and to any suspected
weakness in the diagnostics boundary itself.

## Golden rule

MigraPilot production diagnostics **observe and advise only**. Remediation
(restart, deploy, renew, scale, DB change, DNS change, credential rotation) is
always a separate, change-managed operator action — never performed through
diagnostics, and never triggered automatically by a diagnostic result.

## Responding to a degraded/unhealthy finding

1. Read the `evidence` + `interpretation` + `limitations` in the result.
2. Corroborate with a second read-only capability (e.g. `logs`, `metrics`,
   `summary`) using the run's correlation id.
3. Decide remediation OUTSIDE MigraPilot via the appropriate change-managed
   workflow. `recommendedNextSteps` are advisory text, not actions.
4. Record the correlation id + run id for the operational record.

Examples: `tls` degraded (cert < 14 days) → schedule renewal via the certificate
workflow; `metrics` disk ≥ 95% → capacity action via change management;
`serviceHealth` unhealthy → investigate via logs, then remediate out-of-band.

## Suspected boundary weakness (treat as a security incident)

Any of the following → **disable the provider immediately** and escalate:

- a mutation appears reachable through the diagnostics API;
- a credential value appears in a result, run, log, telemetry, or audit;
- an unregistered/arbitrary target, host, URL, or SQL is accepted;
- a diagnostic appears to have caused a state change.

### Emergency disable

1. Set `MIGRAPILOT_PROD_DIAGNOSTICS_ENABLED=false` (or unset) and restart the
   brain — every request then fails closed (`PROVIDER_DISABLED`).
2. Optionally clear `MIGRAPILOT_PROD_DIAGNOSTICS_OPERATOR_TOKENS` (all runs →
   `UNAUTHORIZED`).
3. Preserve the audit chain (`production.diagnostics.*`) for the correlation.

## Failure codes → meaning

`PROVIDER_DISABLED` fail-closed · `UNAUTHORIZED` operator not authenticated ·
`TARGET_NOT_ALLOWED` unknown/disabled target · `ENVIRONMENT_NOT_ALLOWED` ·
`CAPABILITY_NOT_ALLOWED_FOR_TARGET` · `READ_ONLY_CAPABILITY` mutation/unknown
capability · `ARBITRARY_INPUT_REJECTED` client-supplied target field · `RATE_LIMITED`
· `TIMEOUT`.

## Stop conditions

- Do not enable the provider in an environment not on the allowlist.
- Do not add a target to work around `TARGET_NOT_ALLOWED`.
- Do not widen a credential to make a check "work".
- Do not act on `recommendedNextSteps` automatically.

## Escalation path

Boundary weakness or credential exposure → owner, immediately, provider disabled.
Production delegation and live production mutation remain a **separate governance
program** and are out of scope for this capability.
