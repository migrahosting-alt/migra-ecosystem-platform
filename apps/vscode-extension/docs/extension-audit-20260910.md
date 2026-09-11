# MigraPilot VS Code Extension Audit

**Date:** 2026-09-10  
**Scope:** `apps/vscode-extension` as a first-class MigraPilot client  
**Method:** Source audit against `apps/brain-service`, `apps/migrapilot-console`, shared workspace tools, and the extension's existing tests/docs. No live authenticated console or production approval workflow was exercised.

## Executive Finding

The extension already has a strong governed engineering lane. It uses the shared Brain, the canonical workspace-tool registry, local workspace execution, durable run state, exact-input approvals, evidence-backed proposals, and a native proposal-card model.

The main gap is architectural coverage, not basic coding competence: the extension does not consume the console's mission/autonomy/journal/drift/release evidence model. It is a first-class **Brain coding client**, but only a partial first-class **MigraPilot operating client**.

The first high-value implementation slice should strengthen the existing execution loop and unify its user-facing evidence surface before adding broader console integrations:

`inspect -> plan -> propose -> approve -> edit -> test -> fix -> verify -> evidence`

That slice should preserve the current Brain authority boundary and make structured changesets render as native cards in ordinary chat, rather than exposing protocol-looking tool output.

## Gap Matrix

| Area | Status | Evidence | Finding |
|---|---|---|---|
| Brain transport | **Present** | `src/services/brainClient.ts`, `src/services/migraAiClient.ts` | Brain calls are centralized or routed through the engine facade; governed transport has explicit failure categories, cancellation, and no unsafe retry of consequential work. |
| Shared capability executor | **Present** | `src/services/workspaceTools.ts`, `packages/workspace-tools/src/metadata.ts` | Filesystem/tree/search/Git implementations come from the shared registry; editor diagnostics/symbols are correctly adapted in VS Code. |
| Repository inspection | **Present / partial** | `workspaceTools.ts`, `migraAiClient.ts`, `shellProvider.ts` | Read/search/Git/context collection is real and evidence-aware. Semantic indexing exists through the MigraAI Workspace, but there is no single extension-owned dependency/context graph view joining retrieval, symbols, package boundaries, and runtime services. |
| Canonical engineering execution | **Present for local Brain** | `workspaceTools.ts`, `codingRunClient.ts`, `codingWorkflow.ts` | The Brain plans and the extension executes local workspace tools. The boundary is appropriate for developer files. Remote pilot-api parity is not complete. |
| Multi-step coding loop | **Partial** | `codingWorkflow.ts`, `codingRunClient.ts`, `src/services/migraAiClient.ts` | Governed coding has durable inspect/plan/scope approval/poll/validation states. Ordinary chat agent turns can inspect and propose, but do not yet expose one unified edit-test-fix-verify loop with durable checkpoints. |
| Exact approvals | **Present for existing lanes** | `codingWorkflow.ts`, `changesetApply.ts`, `approvalDelta.ts`, `reviewApprovals.ts` | Scope hashes, revisions, approval tokens, expiry, rejection, resume, and replay-safe reconciliation are implemented. Console mission approvals are not consumed by the extension. |
| Changeset UX | **Present in governed surfaces; partial in chat** | `proposalCardModel.ts`, `proposedChangeset.ts`, `panel/shell/script/chat.ts` | Native proposal cards and approval cards exist. Generic chat tool activity renders tool names/status only, so a structured `fs.proposeChangeset` payload can still arrive through the ordinary answer path without becoming a file list + rationale + diff + test-plan card. |
| Test execution | **Partial** | `commands/runTests.ts`, `commands/generateTests.ts`, `codingRunClient.ts` | Tests can be generated/run through explicit commands and validation can be reported by governed coding. There is no single task-level test ledger that binds commands, exit status, output, changed files, and follow-up repair attempts into one resumable work item. |
| Evidence/provenance | **Present locally; partial cross-client** | `codingRunClient.ts`, `proposalCardModel.ts`, `shellProvider.ts` | Extension evidence includes source spans, hashes, run history, integrity, diffs, and validation state. It does not ingest console journal IDs, mission reports, release artifacts, drift snapshots, or cross-client evidence links. |
| Durable task state | **Present for Brain runs/conversations; missing for full tasks** | `brainPersistence.ts`, `brainStoreVscode.ts`, `migraAiClient.ts` | Conversation and run state survive extension restarts. A multi-step engineering task does not yet have a first-class task record that resumes after a test failure or interrupted repair loop. |
| Git workflow | **Partial** | `gitOverview.ts`, `commitGen/`, `shellProvider.ts` | Read-only status/diff/history/blame and commit-message preparation are strong. Stage/branch/commit preparation and conflict-aware task continuation are not a single governed workflow. |
| Shared Files/Search/etc. capabilities | **Partial** | `workspaceTools.ts`, `migraAiClient.ts` | Workspace Search/Git/Files-like local capabilities exist. Shared Email, GitHub, web research, and operational capabilities are not exposed through one capability catalog in the extension. |
| Model/capability authority | **Present locally; partial ecosystem-wide** | `capabilityResolver.ts`, `commandCapabilities.ts`, `backendRouter.ts` | The extension is model-agnostic and capability-gated. It still has a separate command capability vocabulary from the console mission capability registry. |
| System/environment awareness | **Partial** | `shellProvider.ts`, `shellState.ts`, `projectAuthority.ts` | Workspace root, branch, Brain health, policy, and local execution identity are surfaced. VM/service/environment inventory and console environment authority are absent. |
| Console mission/autonomy integration | **Missing** | No extension client for `apps/migrapilot-console/lib/mission/*` or `/api/autonomy/*` | No mission start/step/confirm/cancel/report, autonomy controls, operator claims, drift correlation, or HIDS/EDR workflow is available in VS Code. |
| Transport ownership | **Duplicated** | `brainClient.ts`, `migraAiClient.ts`, `codingRunClient.ts`, `providerRouterClient.ts` | Multiple clients own overlapping URL normalization, request IDs, timeout/abort, JSON parsing, and error handling. This is a drift risk even where each individual client is tested. |
| Secret handling | **Present for configured provider/pilot paths** | `providerConfigVscode.ts`, token commands, integration plan | SecretStorage is the intended authority for tokens/keys. Remote-pilot live interoperability remains unproven in this audit. |
| Auto-apply safety | **Unsafe unless explicitly restricted** | `package.json` `migrapilot.autoApplyChangeset` | The default is safe, but the setting bypasses the visible review prompt. It should be clearly admin/developer-only and visibly indicated whenever enabled. |
| Live acceptance | **Blocked / not proven here** | Existing status notes and test scripts | Source and deterministic tests are strong, but this audit did not run the real VS Code UI against a live authenticated console/pilot-api workflow. |

## Root Causes Behind the Weak Screenshot Behavior

The boilerplate response pattern is consistent with two local architectural conditions:

1. **The chat path and governed proposal path are adjacent, not unified.** `shellProvider.ts` sends ordinary turns through `runChatTurn`, while `proposalCardModel.ts` and `codingWorkflow.ts` own richer proposal state. A proposal that arrives as an ordinary tool/event payload does not automatically enter the proposal-card model.
2. **The generic chat renderer intentionally reduces tool events to name/status.** `addToolActivity()` in `src/panel/shell/script/chat.ts` renders a compact activity row. That is good for routine reads, but insufficient for a structured changeset: file operations, rationale, diff preview, approval state, and validation plan need a typed message event and native renderer.

This does not mean the extension lacks repository intelligence. It means the ordinary prompt must be routed into the governed engineering workflow when the requested outcome is an actual repository mutation, and the resulting proposal must remain structured all the way to the webview.

## Priority Plan

### P0: Native engineering task envelope

Add one durable task/run envelope shared by ordinary engineering prompts and explicit commands. It should carry:

- task id, workspace root label, branch/head snapshot
- current stage and resumable checkpoint
- files/evidence observed
- proposed changeset identity and approval state
- commands/tests run with exit status and bounded output
- repair attempts and remaining work
- final evidence links and truthful completion state

The envelope should be Brain-owned where possible; the extension stores only the local display/recovery pointer.

### P1: Structured changeset event in chat

Introduce a typed `changesetProposal` host message/event. Render a native card with:

- affected files and operation (`create`, `edit`, `delete`)
- concise rationale per file
- bounded diff preview
- expected test/verification plan
- approval/reject actions bound by host-held proposal identity

Keep raw protocol JSON behind an explicit developer diagnostics action only. Reuse `proposalCardModel.ts`/`approvalDelta.ts`; do not create a second approval protocol.

### P1: Close the execution loop

Make the default engineering workflow explicit and visible:

`inspect -> plan -> changeset proposal -> approval -> apply -> run constrained tests -> repair proposal -> verify`

The loop must stop at each failed or unproven stage, persist the state, and resume rather than restart or claim completion from model text.

### P2: Remove transport duplication

Extract a shared request primitive for request IDs, timeout/abort, response parsing, redaction, and error taxonomy. Keep backend-specific endpoint clients thin. This should follow the execution-loop slice because it reduces the risk of adding another inconsistent client while wiring task state.

### P2: Cross-client evidence bridge

Add a narrow adapter for console/pilot-api evidence rather than importing console implementation files. The extension should be able to display mission/run/report identifiers and links, but must not invent authority or duplicate the console mission store.

### P3: Environment-aware engineering context

Expose the selected project/environment/service as a governed context object. Keep local workspace paths and production VM identities separate, and require explicit environment selection before any deployment or operational capability is offered.

### P3: Shared capability catalog

Replace separate extension-only and console-only capability vocabularies with a versioned capability contract. The extension can then surface Files, Search, GitHub, Email, research, and deployment capabilities only when the Brain/pilot-api publishes them as available for the current identity and environment.

## Recommended First Implementation Slice

Do not begin with console route mirroring or cosmetic changes. Start in the canonical extension with:

1. a typed `EngineeringTask` state model and durable pointer;
2. a structured changeset event emitted by the agent/Brain adapter;
3. a native chat changeset card that reuses the existing approval handshake;
4. a test/verification ledger attached to the task;
5. focused unit + Extension Host tests for inspect/propose/approve/apply/test/fail/resume;
6. the live acceptance case: ask the extension to create a real file in the current repo, inspect the exact proposal, approve it, run the repo's narrow test, and verify the final evidence.

This is the smallest slice that directly addresses the screenshot and moves the extension toward replacing routine Claude Code work.

## Acceptance Gate

The first slice is not complete when the card renders or tests pass alone. The gate is:

- extension `npm run test:unit`
- extension `npm run test:integration`
- extension `npm run test:vsix`
- extension `tsc -b` through the app build
- live VS Code UI proof against the exact installed extension/Brain release identity
- no raw `fs.proposeChangeset` protocol blob in the normal chat surface
- a rejected proposal produces no file mutation
- an approved proposal applies exactly once
- test failure creates a resumable repair state, not a false completion

## Boundaries and Risks

- The current console repo route hard-codes `operatorId: "console-operator"` and `role: "owner"`; it is not a safe authority contract to copy into the extension.
- The console mission store uses synchronous JSON persistence without the extension/Brain revision and atomic-write guarantees; the extension should consume a versioned API contract, not import or imitate that store.
- `autoApplyChangeset` remains a policy escape hatch. It must never become the default path for the new task envelope or obscure approval state.
- This audit is source-backed and test-aware, not live proof. The extension's existing status file still records owner-only UI acceptance gaps, including the mockup build flow.