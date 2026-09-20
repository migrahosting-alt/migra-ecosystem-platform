# Restart-safe Engineer continuation — acceptance contract

Status: CONTRACT RECORDED; IMPLEMENTATION NOT STARTED.
Authority: owner direction, 2026-09-16.
Preceding milestone: **Claude-parity foundations locally verified**, not V1 complete.
Canonical state: [MIGRAPILOT_STATUS.json](./MIGRAPILOT_STATUS.json),
`restartSafeContinuation_2026_09_16`.

## Invariant

**Persist semantic task state, not merely conversation text.** The Brain owns
execution and completion authority. The extension restores a task reference and
its presentation; it cannot reconstruct authority from a saved card or transcript.
A restart must neither erase unfinished work nor grant permission to replay it.

## Current implementation boundary

- [Engineer runtime](../../apps/brain-service/src/engine/engineer/engineerRuntime.ts):
  plan, evidence, transcript, results cache and retry counters are per invocation.
- [Engineer route](../../apps/brain-service/src/engine/engineer/engineerRoutes.ts):
  creates the EngineeringTask envelope for a request; its existence is not a
  durable execution checkpoint.
- [Extension shell](../../apps/vscode-extension/src/panel/shell/shellProvider.ts):
  saves task cards in a VS Code memento, keyed by conversation. This is UI recovery.
- [Apply adapter](../../apps/vscode-extension/src/services/engineeringTaskActions.ts):
  prevents a second apply in the active instance and reports that verification
  has not run after apply. This alone does not prove crash-safe mutation recovery.
- [Persistence contracts](../../apps/brain-service/src/engine/persistence/types.ts):
  existing durable run journals expose versions, events, leases, fencing,
  reconciliation and approval lifecycle fields. Reuse compatible primitives;
  do not assume a command-run journal already represents an Engineer task.

Production authority remains PostgreSQL. Local acceptance must exercise an
isolated PostgreSQL database with real process restarts. In-memory or SQLite
fixtures can support unit tests but cannot prove this persistence requirement.
No production database change or deployment is authorized by this document.

## Durable semantic record

The exact storage/API shape is an implementation decision; these semantics are
mandatory. Version the record and define explicit migration/refusal behavior.

| State | Required meaning |
| --- | --- |
| Identity | Stable task ID, execution/run IDs and lineage, authenticated owner, workspace identity, conversation reference if present |
| Objective | Original user objective and accepted scope changes, separately from chat text |
| Workspace | Canonical workspace binding, repository identity, root reference, Git HEAD and dirty-state fingerprint at checkpoint |
| Plan | Stable step IDs, dependencies, pending/running/completed/blocked state, and evidence for completion |
| Evidence | Controller obligations, satisfied/pending state, observation references, file versions/content hashes and invalidation reasons |
| Tool provenance | Invocation ID, tool and contract/policy version, canonical input identity, start/outcome status, bounded relevant results |
| Proposals | Changeset identity/hash, operations or durable artifact references, source-file preconditions, disposition and apply outcome |
| Validation | Exact command/argv, cwd, input revision/snapshot, start/end, exit code, relevant output, baseline versus introduced failures |
| Repair | Failure-to-repair links, attempts and outcomes, remaining retry/no-progress budgets |
| Lifecycle | Phase distinct from terminal/nonterminal status; precise blocked/failure/cancellation reason; pending operation identity |
| Resume | Schema version, monotonic checkpoint revision, resume generation, execution lease/fence and latest durable event sequence |
| Report | Accepted final and its controller decision/revision, if any; provisional model text is never an accepted final |

Persist only the task-relevant observations needed to continue. Apply existing
secret redaction and access controls; do not store credentials, approval bearer
tokens, unrestricted environment dumps or hidden model reasoning. Hashes alone
are not enough to restore an observation unless its durable content is retrievable.
Missing, expired or evicted evidence must be reread or reported unavailable.

## Checkpoint and execution rules

1. Persist accepted plan changes, successful observations, failures, proposals,
   validation outcomes and budget changes before acknowledging them as durable.
   Checkpoint and journal revisions must remain consistent across crashes.
2. Record operation intent before dispatch and its result after completion. A
   crash between these points means UNKNOWN outcome, never implicit success.
3. Reuse completed read-only work when its evidence is still valid. Record any
   required repetition and its reason; do not unnecessarily rerun the whole plan.
4. Reconcile UNKNOWN operations using authoritative operation state and workspace
   read-back. Do not blindly replay commands, applies or external effects. If safe
   reconciliation is impossible, block with the exact uncertainty and next action.
5. Resume requests carry the task reference and expected revision/generation.
   The server verifies ownership, acquires one execution lease and fences stale
   workers. Concurrent tabs, duplicate Continue clicks and late old-worker results
   must not create two executors or two mutations.
6. Preserve step/retry/no-progress budgets across resume; repeated restarts must
   not reset safety limits. Persist cancellation; terminal tasks do not silently
   restart. A request for new work creates an explicit successor/new task.
7. On a store failure, do not report durable progress or continue mutations whose
   outcome cannot be journaled safely. Show a precise persistence blocker.
8. Only the controller's accepted final reaches the answer transcript, including
   after reconnection. Replayed events/finals are deduplicated by task and revision.

## Mandatory revalidation before execution resumes

- Same authorized principal and workspace binding; root exists and is contained.
  A relocated workspace needs an explicit verified rebind, not path guessing.
- Current Git HEAD, dirty/untracked state and relevant file contents. Preserve
  unrelated user edits. Invalidate only affected evidence/steps when dependencies
  are known; otherwise stop or reinspect conservatively with a stated reason.
- Capabilities, tool contracts, policy and required qualified model availability.
  Route only under current governance; an unavailable model is a truthful blocker.
- Pending changeset preimages/file versions and mutation preconditions, including
  files changed externally while the process was stopped.
- Validation freshness: historical success belongs to its tested snapshot, not to
  current changed files. An interrupted command is not a passing test.
- Approval validity and operation outcome. A historical APPROVED flag is audit
  evidence, **not fresh execution authority**. An unapplied proposal returns to
  review under current preconditions and receives fresh authorization. A proven
  prior apply is reconciled and never applied twice. An uncertain apply blocks
  until its outcome is established; asking approval again does not make replay safe.

Read-only revalidation remains automatic. Restart itself is not a reason to prompt
for permission to read files. Approval is required at the governed mutation boundary.

## Required restart matrix

For every cell, start a real task through the extension and establish a multi-step
plan with completed and pending steps, inspected-file evidence, tool history and
validation state where applicable. Capture the task identity and durable revision.
Restart the named process(es), then use **Continue on the same task** through the UI.

| Phase at interruption | Extension restart | Brain restart | Both restart |
| --- | --- | --- | --- |
| Inspection | R1 | R2 | R3 |
| Edit proposal / awaiting approval | R4 | R5 | R6 |
| Validation / repair after a controlled failing test | R7 | R8 | R9 |

Each cell must prove: same task/objective; plan and completed steps retained;
evidence retained or explicitly invalidated; no unjustified repeat work; no lost
repair/validation state; no premature completion; and either safe continuation or
a precise, evidence-backed blocker. Process IDs/build identities must change where
a restart is claimed. Re-rendering a card or reconnecting a socket is not a restart.

Healthy baseline cells must actually continue; blanket refusal does not pass the
feature. Negative cases below may pass by refusing exactly the unsafe action.

## Fault and authority cases

| Case | Required result |
| --- | --- |
| Workspace missing/moved, wrong repository or different owner | No tool/mutation on guessed workspace; exact binding/access failure |
| HEAD or relevant dirty file changes | Stale evidence/proposal identified; preserve user edits; reinspect or block |
| Unrelated file changes | Explain reconciliation; retain unaffected valid evidence where safe |
| Capability/model becomes unavailable | Current availability checked; truthful blocker, no silent ungoverned fallback |
| Approval pending/expired/rejected/prior-approved | Current review state shown; no historical authorization replay |
| Crash before apply, during apply, after write before result commit | Reconcile pre/postconditions and journal; at most one effect; unknown outcome blocks |
| Crash during validation | Reconcile/terminate only task-owned process as policy permits; no fabricated exit code/pass |
| Two clients resume; old worker returns late | One lease holder; stale revision/fence rejected; no duplicate effects |
| Crash during checkpoint write or persistence outage | Last committed state restored; no partial checkpoint credited |
| Cancellation/terminal task/unsupported schema | Preserve terminal/cancel state or explicit version refusal; no hidden new run |
| Missing durable observation or truncated validation output | Reinspect/rerun safely or report missing evidence; do not manufacture results |
| Network loss and repeated reconnect | Task ownership/revision preserved; events deduplicated; no provisional final leak |

## Evidence and pass gate

For R1–R9 and each fault case record task/run IDs, checkpoint revisions/generations,
process/build identities, restart boundary, before/after semantic state, tool and
mutation counts, invalidation/revalidation decisions, approval disposition,
validation exits and rendered UI result. Capture browser/extension evidence and
actual file read-back; redact secrets. Fault injection must identify the exact
intent/result/checkpoint boundary rather than rely on timing luck.

Required local gate: Brain and extension app test commands, `tsc -b`, extension
unit suite, PostgreSQL restart/concurrency tests, and live UI verification of this
matrix. Scripted providers can deterministically prove fault handling but are not
proof of the owner's integrated real-model workflow. Every matrix case starts
NOT RUN; documentation is not implementation or acceptance.

## Subsequent integrated V1 owner gate

On a fresh real repository, through the installed extension and governed Brain:

1. Map the repository correctly and investigate the requested change.
2. Produce a meaningful multi-file proposal and show its accurate diff.
3. Validate the proposed snapshot in a governed isolated preview/worktree (or an
   equivalent existing validated mechanism); record how it maps to the proposal.
   Testing the unchanged workspace must not be described as testing pending edits.
4. Encounter a controlled validation failure, diagnose it, repair the proposal,
   and survive a restart while meaningful task state exists.
5. Continue the same task and rerun validation against the updated candidate.
6. Present the actual diff and validation result, obtain governed apply authority,
   apply once, read files back and rerun relevant checks on the applied workspace.
7. Deliver only the accepted final, with actual results and remaining limitations.
8. The owner tests the actual changed product and explicitly accepts the result.

Capture installed extension identity, Brain release/commit identity, model
qualification/routing, repository identity, exact commands and results. Only a
successful real-system workflow supports PROVEN_LIVE; V1 ACCEPTED additionally
requires the explicit owner acceptance above. Neither flag is implied by local
suite counts, scripted browser checks or this recorded contract.
