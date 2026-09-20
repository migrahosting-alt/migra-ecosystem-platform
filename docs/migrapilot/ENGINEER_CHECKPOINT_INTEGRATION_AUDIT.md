# Engineer checkpoint integration audit — 2026-09-16

Status: SOURCE AUDIT COMPLETE; IMPLEMENTATION NOT STARTED.
Scope: select the persistence integration boundary before changing runtime behavior.
No runtime tests, database access, restarts, migrations or deployments were performed.

## Decision

**AgentRunJournal cannot serve an inspection-only Engineer checkpoint unchanged
without false approval lifecycle semantics.** Use a small EngineerCheckpointStore
adapter on the existing Brain PostgreSQL persistence layer, keyed by the existing
correlation ID and protected by authenticated owner/workspace scope.

The existing `runEngineerTask` remains the sole semantic execution/completion
controller. The adapter stores/loads versioned state and enforces write concurrency;
it is not a second scheduler, task engine, model loop or approval service.

## Source evidence for the decision

| Source | Finding |
| --- | --- |
| [agentRunJournal.ts](../../apps/brain-service/src/engine/agents/agentRunJournal.ts), `AgentRunCreateInput` | Requires activation, recipe, proposal, snapshot, executable and command-preview fields before any checkpoint can be created. |
| Same file, `create()` and `buildRun()` | Unconditionally creates `AWAITING_APPROVAL`, `PENDING_DISPLAY`, `proposal.created` and `approval.requested`. A domain payload does not alter those semantics. |
| [codingRunService.ts](../../apps/brain-service/src/engine/coding/codingRunService.ts), `start()` creation path | Already compensates by transitioning immediately from `AWAITING_APPROVAL` to `PLANNING`. The earlier approval events remain. Do not copy this workaround for Engineer inspection. |
| [postgresStore.ts](../../apps/brain-service/src/engine/persistence/postgresStore.ts), journal methods | Insert, event append and transition each use their own transaction. Creation followed by correction is not one atomic semantic initialization; a crash can leave the intermediate approval state. |
| [agentRunSchema.ts](../../apps/brain-service/src/engine/persistence/postgres/agentRunSchema.ts) | `agent_runs` requires recipe/proposal/snapshot/executable columns. `state` is TEXT, not a restrictive enum CHECK: the incompatibility is the API/lifecycle and required row semantics, not an asserted SQL prohibition. |
| [types.ts](../../apps/brain-service/src/engine/persistence/types.ts), `DurableAgentRunState` | Models command/coding phases such as `AWAITING_APPROVAL`, `APPROVED`, `EXECUTING`, `EXPIRED`; does not express the proposed Engineer status contract directly. |
| [agentModeCommandService.ts](../../apps/brain-service/src/engine/agents/agentModeCommandService.ts), `reconcileOnStartup()` | Explicitly excludes rows with `domainKind`. This prevents command-recovery policy from expiring domain runs, but does not supply Engineer recovery or fix creation history. |
| [codingRecovery.ts](../../apps/brain-service/src/engine/coding/codingRecovery.ts) | Coding has its own scope-approval and uncertain-mutation rules. They are reference material, not automatically Engineer policy. |

The journal has valuable version/CAS, event ordering, reconciliation lease/fence,
redaction and domain-payload validation patterns. Reuse compatible lower-level
patterns through the existing persistence connection, transaction, scope/RLS and
append-only migration framework. Do not bypass journal creation with fabricated
command fields or broaden shared command lifecycle semantics for this slice.
Generalizing the journal to honest workflow-specific creation would be a separate,
larger change; it is not the smallest integration under the owner's criterion.

## Existing durability surfaces and identities

- **Brain controller:** [engineerRuntime.ts](../../apps/brain-service/src/engine/engineer/engineerRuntime.ts)
  initializes transcript, result cache, seen-result hashes, plan, CA2 ledger,
  correction counters, no-progress/replan budgets and proposal counts per invocation.
  It has no checkpoint save/load input. Recovery must restore the state that actually
  governs decisions, not just descriptive fields with similar names.
- **Brain request:** [engineerRoutes.ts](../../apps/brain-service/src/engine/engineer/engineerRoutes.ts)
  takes `x-correlation-id` or generates an ID; `EngineeringTask.taskId` equals that ID.
  It creates a fresh envelope and calls the loop. Disconnect marks the stream closed,
  disposes workspace delegates and stops driving the loop at the event boundary.
  Existing `/engineer/recovery/*` endpoints restore partial workspace writes from
  reverse material; they do not resume the semantic loop. Their RecoveryManager
  stashes/bundles are in-memory maps.
- **Task-envelope limitation:** the route appends tool identifiers to `observedFiles`.
  The envelope's evidence/command arrays and repair counter are not the runtime
  ledger/history. Persisting this card unchanged would lose the required semantics.
- **Extension dispatch evidence:** [brainStoreVscode.ts](../../apps/vscode-extension/src/services/brainStoreVscode.ts)
  stores under `globalStorageUri/brain-execution`.
  [chatChildDispatch.ts](../../apps/vscode-extension/src/services/chatChildDispatch.ts)
  persists parent/child references before dispatch. Parent turn IDs and child
  operation IDs are separate from the Engineer correlation ID. This history must
  stay intact, but it is not the source of the Engineer plan/evidence.
- **Extension restart:** [brainPersistence.ts](../../apps/vscode-extension/src/services/brainPersistence.ts)
  classifies in-flight operations as interrupted failures and preserves terminal
  operations. It does not replay work. [chatTurnExecution.ts](../../apps/vscode-extension/src/services/chatTurnExecution.ts)
  persists parent/child lifecycle, not Engineer semantic observations.
- **Extension presentation:** [shellProvider.ts](../../apps/vscode-extension/src/panel/shell/shellProvider.ts)
  saves task cards by conversation ID through workspaceState and redisplays them
  onReady. Cards are presentation history, never resume authority.
- **Extension transport:** [migraAiClient.ts](../../apps/vscode-extension/src/services/migraAiClient.ts)
  creates a fresh transport request ID and POSTs `/api/ai/engineer`. EOF without
  `done` raises `STREAM_INTERRUPTED`. No same-task resume request exists there.
  The correlation log is a process-wide bounded ring, not durable discovery.

## Checkpoint boundary for the first implementation slice

Follow the owner's EngineerCheckpointV1 fields: taskStateVersion, correlationId,
workspaceId/rootPath, objective/intent, phase, plan, completion evidence,
observations, proposal/validation state, repair history, workspace snapshot,
resumeEpoch, terminal/nonterminal status and updatedAt.

Persistence metadata must additionally bind authenticated owner/workspace scope,
monotonic record revision and exclusive resume ownership/fencing. The correlation
ID identifies a task; possession of it does not authorize loading/resuming it.
Keep schema version, record revision and resume epoch distinct.

Snapshot the actual decision state: normalize Sets/Maps explicitly; retain stable
plan-step identities and evidence references; retain consumed step/correction/retry
budgets and relevant tool outcomes/dedup identities. Resume must not reset bounded
retries or count failed/unacknowledged observations as successful inspection.
Historical content is bounded/redacted and tied to hashes. Missing evidence must
be reinspected or reported unavailable, not silently converted into an empty result.

Never restore approval tokens, transient PIDs/live-command status, or an
unreconciled mutation outcome as execution authority. Proposal disposition and
operation intent/outcome can be historical evidence; they are not permission.

A minimal persistence interface should support scoped create/load, conditional
checkpoint save and exclusive resume acquisition/release. It must refuse unavailable
persistence rather than silently use an in-memory substitute. Implementation must
use the existing PostgreSQL scope/transaction framework, not another connection
configuration or separate local canonical database.

## First proof: Brain restart during read-only inspection only

1. Through the existing Engineer controller, inspect root and Git, read manifest,
   establish a plan and satisfy some (not all) completion obligations.
2. Durably acknowledge a semantic checkpoint with task ID, revision and evidence.
3. Restart a task-owned isolated Brain process against the same isolated PostgreSQL
   database; prove that a different process loaded persisted state.
4. Resume the same correlation ID after verifying owner/workspace scope and acquiring
   the current resume epoch/lease. Restore plan/evidence and remaining budgets.
5. Revalidate workspace existence/binding, Git HEAD/dirty state, relevant file hashes,
   capability/model availability. Label verification reads separately from repeated
   semantic inspection; retain valid completed observations rather than rerunning them.
6. Continue remaining obligations and publish only the controller-accepted final.
   Assert no duplicate credited inspection, no fabricated progress and no second executor.
7. Negative checks: wrong scope, stale revision/concurrent resume, missing workspace,
   changed relevant file/Git state, unsupported version and failed checkpoint write.
   Reject or invalidate/reinspect precisely; do not silently start another task.

Extension restart/reconnect changes, proposal resume, command/validation resume and
uncertain mutation recovery remain outside this first slice. They remain required
later under [RESTART_SAFE_CONTINUATION_ACCEPTANCE.md](./RESTART_SAFE_CONTINUATION_ACCEPTANCE.md).
The existing 3x3 matrix is unchanged; this first proof corresponds to R2 (Brain
restart during inspection), not R1 (extension restart).

## Audit execution

Ran the requested targeted ranges/searches and followed imports into actual schema,
repository, startup and extension persistence code. Two supplied extension paths do
not exist: `src/persistence/brainStoreVscode.ts` and `src/client/migraAiClient.ts`.
The actual files are both under `src/services/`; the requested client fallback also
points to a nonexistent directory. Those misses were recorded, then corrected for
inspection. Raw output was captured in `/tmp/migrapilot-checkpoint-audit.VCCPMo/`.

This is a source-backed integration decision, not a restart test result. No checkpoint
store, migration, resume route or extension behavior has been implemented by this audit.
