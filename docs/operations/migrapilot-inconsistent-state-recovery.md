# Runbook — `INCONSISTENT_STATE` Recovery

© MigraTeck LLC. Internal operational document.

An `INCONSISTENT_STATE` means an `fs.applyChangeset` failed mid-apply **and the
rollback itself failed** — the workspace may be in a mixed/partial state. This
is a **critical incident**. Recovery is approval-gated and correlated; the
incident cannot be resolved without validation evidence.

## Prerequisites

- The **incident id** (`GET /api/ai/engineer/incidents`) and the originating
  **correlation id**.
- Local access to the recovery endpoints (non-production).

## Procedure

1. **Quarantine the workspace** — stop all further `fs.applyChangeset` against
   it until recovery completes.
2. **Acknowledge the incident:** confirm it is `open`/`critical`
   (`GET /api/ai/engineer/incidents/:id`). Note its `deduplication_key`,
   `applied_file_count`, `rollback_failure_count`, `failure_stage`.
3. **Preserve evidence:** export the sanitized audit chain
   `GET /api/ai/engineer/audit?correlationId=<id>` and record current filesystem
   state. Do not mutate the workspace by hand.
4. **Identify files applied before failure** (the `application.rollback_failed`
   record's counts) and the rollback failure.
5. **Plan an approval-gated recovery** (zero writes):
   `POST /api/ai/engineer/incidents/:id/recovery/plan` → returns a `recoveryId`,
   a `recoveryCorrelationId`, an `opsSummary`, and a **single-use**
   `approvalToken`. Optionally `POST .../recovery/:recoveryId/simulate` to
   preview without writing.
6. **Restore** from the engine's reverse material (recommended), or from VCS /
   verified backup if reverse material is unavailable:
   `POST .../recovery/:recoveryId/apply { "approvalToken": "<token>" }`. This
   applies through the SAME contained, atomic changeset engine — never a bypass.
7. **Run integrity + build validation:**
   `POST .../recovery/:recoveryId/verify` returns the validation evidence
   (files restored to expected content). Also run project build/tests.
8. **Resolve the incident only after operator verification:**
   `POST .../recovery/:recoveryId/resolve` — this REQUIRES passing validation
   evidence and links the recovery correlation to the incident. An incident can
   never be resolved merely because tooling returned success.
9. **Create a NEW proposal** for any remaining correction (normal flow).

## Stop conditions

- Reverse material missing (`NO_REVERSE_MATERIAL`) → restore from VCS/backup,
  then verify before resolving.
- Recovery apply fails → the incident stays open; do not force. Re-plan.
- Validation fails → do NOT resolve; the incident stays open.

## Escalation

- Recovery cannot restore the workspace → escalate to the owner before any
  further mutation.

## Prohibited shortcuts

- No "force repair" command exists and none may be added.
- Recovery mutation must go through the approval-gated recovery apply — never a
  direct write.
- Never auto-resolve an incident on tooling success without validation evidence.
