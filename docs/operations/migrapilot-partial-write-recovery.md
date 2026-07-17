# Runbook — `PARTIAL_WRITE` Recovery

© MigraTeck LLC. Internal operational document.

A `PARTIAL_WRITE` means an `fs.applyChangeset` failed mid-apply and the engine
**rolled back cleanly** — the workspace was restored to its pre-state and the
proposal + approval were consumed. This is the less-severe case; no critical
incident is raised. Follow these steps to confirm integrity and move on.

## Prerequisites

- The originating execution's **correlation id** (returned on the SSE `route`
  event / in the `stores/health` recent window).
- Local access to the brain audit + incident endpoints (non-production).

## Procedure

1. **Stop further apply attempts** for the affected workspace until verified.
2. **Locate the failure by correlation id:**
   `GET /api/ai/engineer/audit?correlationId=<id>` — expect
   `application.started` → `application.rollback_completed` (outcome
   `rolled_back`). There should be **no** `application.rollback_failed`.
3. **Inspect the durable audit chain** for the applied-file inventory
   (`created` / `modified` / `deleted` counts on the `application.*` records).
4. **Verify the reverse material was applied:** the clean rollback means the
   files listed were restored to their prior content. Confirm the workspace on
   disk matches the expected pre-state.
5. **Compare workspace state against expected pre-state** (git status / diff).
   If clean, no restoration is needed.
6. If any drift remains, **create a NEW proposal** for the correction and take
   it through the normal propose → approve → apply flow.
7. **Validate the workspace** (build / test as appropriate).
8. **Document resolution** with the correlation id and the checks performed.
9. **Do not reuse** the consumed proposal or approval — they are single-use.

## Stop conditions

- If you find `application.rollback_failed` for this correlation, this is NOT a
  clean `PARTIAL_WRITE` — switch to the `INCONSISTENT_STATE` runbook.

## Escalation

- Repeated `PARTIAL_WRITE` on the same workspace → investigate the tool/fault
  cause before further applies.

## Prohibited shortcuts

- No `--no-verify`, no manual edits that skip a new approval, no reuse of the
  consumed proposal.
