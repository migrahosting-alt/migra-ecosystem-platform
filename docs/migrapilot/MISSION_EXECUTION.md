# MigraPilot — NL Mission Execution (Thread 2)

Turns a natural-language mission into controlled, resumable, auditable task
execution. Replaces the `missionWorker` stub that marked tasks done without
running anything (`missionWorker.ts:118`), and fixes the always-false Tier-3
guard.

## Pipeline

```
NL mission → intake/validate → plan (tasks + tool calls) → worker steps tasks
  → decideTaskExecution → [skip | await_approval | denied | execute]
  → executeMissionTask → tool-runner (gated) → record → state transition
  → mission finalize → report
```

Intake, classification, and planning are the existing engineeringOs mission
services (`missionService`, `commander`). This change implements the **execution
lifecycle** — the previously-stubbed step.

## Action-level model

`computeTaskActionLevel(task)` = max over the task's tool calls:

| Level | Meaning | Behavior |
|------|---------|----------|
| 0 | local READ | execute (reads are safe) |
| 1 | draft / dry-run | execute as dry-run |
| 2 | local WRITE | **requires approval** |
| 3 | local command / DANGER | **requires approval** |
| 5 | remote READ | requires policy allow (`remoteReadAllowed`) |
| 6 | remote WRITE/DANGER | **disabled** unless `remoteMutationEnabled` + `level6GatesMet` + approval |

Unknown tool → `undefined` → denied (fail closed).

## Task state machine (`nextTaskStatus`, deterministic)

```
pending ──run──▶ running ──▶ done            (success / skip)
                        └──▶ awaiting_approval (needs approval)
                        └──▶ failed            (critical failure, retries exhausted)
                        └──▶ pending           (retriable failure, budget remains)
                        └──▶ skipped           (cancelled, or nonCritical failure/denial)
```

Mission status rolls up from its tasks (existing worker logic): all done →
`completed`; any critical `failed` → `failed`; a task awaiting approval sets the
mission to `awaiting_approval`.

## Safety guarantees

- **No hidden mutation** — every tool call goes through the gated `@migra/tool-runner`.
- **No automatic production execution** — the worker sets `approvalGranted:false`;
  local writes/commands route to `awaiting_approval`, never auto-run.
- **Remote writes disabled by default** — Level 6 requires `PILOT_REMOTE_MUTATION_ENABLED=true`
  **and** all Level-6 gates **and** approval.
- **Fail closed** — missing identity/config → `denied (IDENTITY_MISSING)`; unknown tool → denied.
- **Dry-run default** — anything not explicitly a live opt-in runs as a preview (aligns with S6).

## Worker behavior

- Bounded retries: `task.maxRetries`; retriable = timeout / execution error.
- Timeout: 25s per tool call (`withTimeout`, unref'd timer).
- Cancellation: checked before every tool call — never mid-mutation.
- Idempotency: attempt-scoped key `missionId:taskId:toolName:attempt`.
- Deterministic transitions; every transition emits an activity event + persists a `MissionToolRun`.
- Per-mission lock (existing `acquireMissionLock`) prevents concurrent steppers → safe restart/resume.

## Result synthesis

`getMissionReport` (existing) aggregates task statuses, tool runs, journal entry
IDs, verification, and next actions. It never reports success when a critical
task failed (mission status = `failed`).

## Retry / cancel / resume

- **Retry** — a retriable failure returns the task to `pending`; the next worker
  cycle re-steps it with an incremented attempt (new idempotency key).
- **Cancel** — set mission `status = "canceled"`; the executor returns `skipped`
  for the current task and runs no further tools.
- **Resume (crash recovery)** — the worker is idempotent and lock-guarded; on
  restart it re-selects `running`/`pending` missions and continues. Completed
  tool calls are guarded by the tool-runner idempotency store.

## Operator troubleshooting

| Symptom | Cause | Action |
|--------|-------|--------|
| Task stuck `awaiting_approval` | local write/command or remote mutation needs approval | approve via `/api/approvals`; re-step |
| Task `denied REMOTE_MUTATION_DISABLED` | remote write with mutation disabled | intended; enable only with full Level-6 gates |
| Task `denied IDENTITY_MISSING` | mission operator not recorded | recreate mission with a valid operator identity |
| Task `denied LEVEL6_GATES_UNMET` | remote write, gates unmet | satisfy target-verify / rollback / secrets gates |
| Repeated `pending` re-tries | retriable tool failure | inspect `MissionToolRun.errorCode`; fix root cause |

## Configuration

| Env | Default | Effect |
|-----|---------|--------|
| `PILOT_REMOTE_MUTATION_ENABLED` | unset (false) | must be `true` to allow any Level-6 execution |
| `PILOT_REMOTE_READ_DISABLED` | unset (reads allowed) | `true` blocks Level-5 remote reads |

## Code

- `services/pilot-api/src/services/engineeringOs/missionExecutor.ts` — decision + state machine + orchestrator.
- `services/pilot-api/src/worker/missionWorker.ts` — wires the executor (replaces the stub, fixes the Tier-3 guard).
- Tests: `missionExecutor.test.ts` — 23 cases across the 16 mission scenarios.
