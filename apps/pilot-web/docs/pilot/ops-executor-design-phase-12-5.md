# MigraPilot Dev-Only Action Executor — Design (Phase 12.5)

> **Status: DESIGN ONLY — NOT IMPLEMENTED.** This document is a blueprint for a *future* dev-only
> action executor. **No executor exists. No real action is executable.** Nothing in this phase
> changes runtime behavior: `ops-eligibility-policy.ts` still returns `eligibleForExecution:false`
> for every input, `ops-service-preflight.ts` still returns `eligibleForFutureExecution:false`, every
> real verb in `ops-action-registry.ts` is `enabled:false` and classified **blocked** by `policy.ts`,
> and the target allowlist (`ops-target-allowlist.ts`) returns `eligible:false` for everything.
>
> **Hard rule (Phase 12.5):** there is **no executable path for real actions** after this phase. The
> executor described below MUST NOT be built until every promotion gate in §9 is explicitly cleared
> by a human (Bonex).

## 0. Where this fits

MigraPilot has, in order, built the *read-only and approval-gated* rails that a real executor would
sit on top of — each one already provably non-executing:

| Layer | Module | Current guarantee |
|---|---|---|
| Action catalog | `lib/pilot/ops-action-registry.ts` | real verbs `enabled:false`, `executionMode:"disabled"` |
| Target gate | `lib/pilot/ops-target-allowlist.ts` | `eligible:false` always; production never eligible |
| Operational readiness | `lib/pilot/ops-service-preflight.ts` | `eligibleForFutureExecution:false` always |
| Structural readiness | `lib/pilot/ops-eligibility-policy.ts` | `eligibleForExecution:false` always; `eligibleForFuturePromotion` separate |
| Approval persistence | `lib/pilot/approval-store.ts` (+ `approval-store-pg.ts`) | atomic exact-once claim; 409 on re-approve |
| Audit | `lib/pilot/ops-action-journal.ts` (+ `ops-action-journal-pg.ts`) | append-only action records |
| Classifier | `lib/pilot/policy.ts` | every real verb → `blocked` |

The executor is the **only** missing piece, and it is intentionally missing. This document defines
exactly what it would have to be, so that a future implementation is a careful, reviewable, gated
step — never an accident.

## 1. Future minimal interface (documentation only — NOT wired)

These types are illustrative for the design. They are **not** added to source in this phase.

```ts
// ILLUSTRATIVE — not compiled, not imported anywhere.
type PilotExecutorRequest = {
  targetId: string;
  actionName: string;
  payload: unknown;       // action-specific; hashed for approval binding
  approvalId: string;     // must match an approved, fresh, single-use claim
  dryRunOnly: boolean;    // true => plan/diff only, never mutate
};

type PilotExecutorResult = {
  executionId: string;
  status: "dry_run" | "completed" | "degraded" | "failed" | "rejected";
  eligibleForExecution: false; // remains false until a real executor is promoted (§9)
  journalRefs: string[];       // ids of the events in §7
  reportId?: string;
  rollbackRecommended?: boolean;
  redactedSummary: string;     // secrets/sensitive fields stripped
};

type ExecutorGateResult = { name: string; passed: boolean; required: boolean; evidence: string };
```

The `payload` is never logged raw; only its hash (for approval binding) and a redacted projection
appear in the journal or report.

## 2. Executor lifecycle (future)

Strictly ordered. Any gate failure short-circuits to `executor.failed` / `rejected` (see §8).

1. **Request intake** — receive `PilotExecutorRequest`; validate shape; reject on malformed input.
2. **Target resolution** — `checkOpsTarget(targetId, actionName)`; capture environment + flags.
3. **Action registry lookup** — find the entry in `ops-action-registry.ts`; capture `enabled`/`executionMode`.
4. **Eligibility check** — `checkEligibility(...)`; require no required-gate failures.
5. **Preflight check** — `runServicePreflight(...)`; require overall `pass` (no required failure).
6. **Approval requirement** — require an `approvalId`; load the approval record.
7. **Exact action binding** — verify the approval's `{targetId, actionName, payloadHash}` matches this
   request **exactly**; reject on any drift.
8. **Dry-run / plan generation** — produce a grounded plan/diff; if `dryRunOnly`, stop here and return.
9. **Execution lock** — acquire a per-`(targetId, actionName)` lock; reject if not acquirable (§8).
10. **Execution-start journal entry** — write `executor.action_started` (after lock + approval verify).
11. **Precheck execution** — run required prechecks; abort before any mutation if any fail.
12. **Action execution** — perform the bound action via its adapter (only a promoted, enabled dev action).
13. **Postcheck execution** — run required postchecks.
14. **Health verification** — allowlisted health checks only (`buildHealthBundle`), bodies never returned.
15. **Rollback / recovery guidance** — on health/postcheck failure, *recommend* rollback (never auto).
16. **Final journal entry** — write terminal event (`executor.action_completed` / `failed`).
17. **Report generation** — redacted evidence report; release lock.

## 3. Mandatory safety gates (future — all required, fail-closed)

1. Target is **dev-only** (`environment === "dev"`).
2. **Production target never executable** (hard refuse).
3. Target **enabled**.
4. Action **exists** in the registry.
5. Action **enabled** in the registry (`enabled:true`, `executionMode:"real"`).
6. Action **in** `target.allowedActionNames`.
7. Action **not in** `target.deniedActionNames`.
8. **Approval ID required**.
9. Approval matches the **exact** `target / action / payload hash`.
10. Approval is **fresh and single-use** (atomic claim; re-use → reject).
11. **Postgres approval store required** for real execution (memory store forbidden for real verbs).
12. **Postgres ops journal required** for real execution (memory journal forbidden for real verbs).
13. **Preflight must pass** (overall `pass`).
14. **Eligibility must pass** for future promotion (`eligibleForFuturePromotion === true`).
15. **Health URL must be allowlisted** when the action requires health verification.
16. **Rollback / recovery note present**.
17. **Operator confirmation required** (explicit human step).
18. **Execution lock required** (no concurrent execution per target/action).
19. **Secrets never logged**; **reports redact** sensitive fields.

## 4. Explicitly forbidden — permanently out of scope for the dev executor

`production execution` · `shell access` · `SSH arbitrary commands` · `deploy execution` ·
`restart execution` · `DNS mutation` · `billing mutation` · `DB migration` · `file deletion` ·
`chmod/chown` · `package install` · `infrastructure provisioning` · `customer service mutation` ·
`secret rotation` · `credential printing`.

These remain blocked by `policy.ts` (`OPS_BLOCKED` + `BLOCKED_RE` + `isRegistryDisabledAction`) and are
**not** reachable by any promoted dev executor. A dev executor, if ever built, may only run a *narrow,
registry-enabled, dev-target* action candidate — never any item on this list.

## 5. Required journal events (future)

Append-only, via `ops-action-journal.ts`; secrets stripped (`sanitizeActionMetadata`):

`executor.requested` · `executor.eligibility_checked` · `executor.preflight_checked` ·
`executor.approval_verified` · `executor.lock_acquired` · `executor.prechecks_started` ·
`executor.prechecks_passed` · `executor.action_started` · `executor.action_completed` ·
`executor.postchecks_started` · `executor.postchecks_passed` · `executor.health_verified` ·
`executor.report_generated` · `executor.failed` · `executor.rollback_recommended` ·
`executor.lock_released`.

## 6. Failure behavior (future — fail closed)

- **Fail closed** — any uncertainty rejects; default deny.
- **No partial silent success** — every outcome is journaled with a terminal event.
- **Approval consumed only at a safe point** — claimed atomically immediately before `action_started`,
  never earlier (so a rejected/aborted run does not burn the approval).
- **Prechecks fail → no execution** (abort before any mutation).
- **Postchecks fail → mark `degraded`** + generate recovery guidance (no auto-fix).
- **Health fails → recommend rollback, do NOT auto-rollback** (human decides).
- **Lock not acquirable → reject** execution.
- **Target/action drift after approval → reject** (approval binding mismatch).
- **Journal write fails → reject** (no execution without a durable audit trail).

## 7. Promotion gates — ALL required before any real executor may be implemented

1. **Explicit human approval from Bonex.**
2. Design reviewed.
3. Dev target allowlist finalized (real dev target via `PILOT_OPS_TARGET_ALLOWLIST_JSON`).
4. Registry has **at least one safe dev-only real action candidate** (currently zero — all real verbs disabled).
5. Postgres approvals verified in the target environment.
6. Postgres ops journal verified in the target environment.
7. Executor **lock storage** designed (see Phase 12.6 candidate).
8. Redaction policy tested.
9. Health verification tested.
10. Rollback runbook tested.
11. UI warning / approval UX reviewed.
12. CI / typecheck / build green.
13. **No production target configured.**

Until all 13 are cleared, `eligibleForExecution` stays hard-`false` and no executor module is created.

## 8. What this phase does NOT do

- Does not add an executor module, adapter, route, or tool.
- Does not enable any registry action or change any classification.
- Does not alter `eligibleForExecution` / `eligibleForFutureExecution` / target `eligible` (all stay false).
- Does not touch memory/approval/journal/pgvector defaults.
- Adds **only this document**.

## 9. Next safe forks (after 12.5)

- **12.6 — Executor lock design** (push ops-safety depth): design the per-target/action lock storage +
  acquisition/expiry semantics referenced in §2 step 9 and §7 promotion gate 7.
  → Now specified in [`ops-executor-lock-design-phase-12-6.md`](./ops-executor-lock-design-phase-12-6.md).
- **Real SDXL endpoint live test** (push image generation): wire the already-hardened image adapter to a
  real endpoint (separate track from ops execution).

Either is read-only/design or clearly-scoped; neither creates a real-action executor.
