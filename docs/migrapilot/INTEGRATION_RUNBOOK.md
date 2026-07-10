# MigraPilot — Canonical Integration Runbook (2026-07-10)

The three verified patches and the remaining subsystem work cannot be applied or
committed from the current dev environment. This runbook is the actionable handoff:
apply/verify steps for the patches, and an evidence-based status for every remaining
subsystem so nothing already-built is duplicated.

## Environmental blocker (why this is a handoff, not a commit)

Verified from this WSL checkout:
- `services/pilot-api` and `apps/vscode-extension` are **untracked** here (root `.gitignore`
  catch-all `*`; carve-outs only track `migrapilot-console`, `migrapilot-runner-local/-server`,
  `migrapilot-desktop`, the retired `migrapilot-vscode-extension`, all-app metadata, `MigraTeck/**`).
- pilot-api source of truth is the on-host git `root@100.119.105.93:/opt/migra/git` — **unreachable**
  from here (TCP `:22` fails, `git ls-remote` times out, no Tailscale CLI).
- `origin` (GitHub `migra-ecosystem-platform`) is **infra-notes only** (no app/service code).
- `apps/pilot-web` is a **nested git repo** with 424 uncommitted files (redesign in flight) — unsafe to touch.

Result: the patches must be applied where pilot-api is actually tracked (on-host), and
remaining canonical work must be authored there. This cannot be solved locally.

## Patches — apply in dependency order (on the host that tracks pilot-api)

All three are in `docs/migrapilot/patches/`, validated to reproduce the working tree byte-for-byte.

```bash
# from the repo root that contains services/pilot-api/
git apply --check docs/migrapilot/patches/pilot-api-approval-hardening-S1-S4.patch && \
git apply         docs/migrapilot/patches/pilot-api-approval-hardening-S1-S4.patch   # 1

git apply --check docs/migrapilot/patches/pilot-api-hardening-S5-S7.patch && \
git apply         docs/migrapilot/patches/pilot-api-hardening-S5-S7.patch            # 2

git apply --check docs/migrapilot/patches/pilot-api-mission-execution.patch && \
git apply         docs/migrapilot/patches/pilot-api-mission-execution.patch          # 3
# if the tree has drifted: patch -p1 < <patch>  (fuzz-tolerant)
```
Verify: `cd services/pilot-api && npx tsc -p tsconfig.json --noEmit && npx vitest run`
→ expect **0 tsc errors, ≥95 tests passing** (locally: 95/95, 12 files).
Then commit in the three coherent commits described in each patch's header. **Do not deploy.**
Deploy prerequisite: `APPROVAL_SIGNING_SECRET` must be set in prod (S2 fail-closed).

## Remaining subsystems — status by inspection (DONE = do not rebuild)

Evidence in [PILOT_API_CAPABILITY_MAP.md](PILOT_API_CAPABILITY_MAP.md) and [CONSOLIDATION_GAP_ANALYSIS.md](CONSOLIDATION_GAP_ANALYSIS.md).

| # | Subsystem | Status | Where / evidence |
|---|-----------|--------|------------------|
| 1 | VS Code draft-diff / patch preview | **DONE** | `apps/vscode-extension/src/services/proposedEdits.ts` — `vscode.diff` preview |
| 2 | Patch review | **DONE** | edit.preview tool + preview render; pilot-api `code.preview` |
| 3 | Before/after edit previews | **DONE** | `proposedEdits.ts showPreview()` (original vs after) |
| 4 | Approval-gated local writes | **DONE** | `proposedEdits.ts` "Apply Patch"/"Dismiss" + dirty/stale + path-traversal guard |
| 5 | Allowlisted compile/test/lint/build | **DONE** | pilot-api `repo.command` (allowlisted: tsc/build/test); tool-runner policyGuard |
| 6 | Git status/diff/stage/commit + approval | **DONE** | brain-service `gitStatus`/`gitDiff`; pilot-api `git.*` tools; extension `generateCommit` |
| 7 | Repository indexing | **PARTIAL** | pilot-web `knowledge.ts` (file/pgvector); brain-service repo-map `false` |
| 8 | Lexical + semantic search | **DONE (lexical) / PARTIAL (semantic)** | pilot-web embeddings (nomic-embed); pilot-api RAG keyword-only |
| 9 | Multi-project intelligence | **DONE** | `project-registry.ts` (11 projects); resource graph commands |
| 10 | Command center | **DONE** | 44 `/api/pilot/*` routes; PilotShell/Admin/CommandPalette |
| 11 | Model-provider routing | **DONE** | pilot-api `llm/router.ts` (Anthropic 3-tier + local), circuit breaker, budgets |
| 12 | Tool registry | **DONE** | `packages/tooling` + `@migra/tool-runner`; ~40 tools |
| 13 | Specialized agents | **DONE** | pilot-api `services/agents/` (planner/reviewer/tool/summarizer/incident) |
| 14 | Memory | **DONE (KV) / PARTIAL (semantic)** | `memory/memoryService.ts` (AuditLog-backed) |
| 15 | Approvals | **DONE + hardened** | `approvalService` + PilotApproval; **S1/S5 patches** here |
| 16 | Resumable task automation | **DONE + completed** | engineeringOs v2 + worker; **mission-execution patch** completes the stub |
| 17 | Voice transcript-confirmation | **EXTERNAL** | not in pilot-api; belongs to Pale/voice stack (frozen per project notes) |
| 18 | Evaluations | **DONE** | `src/eval/harness.ts` (~55) + `scripts/evals/*` + benchmarks |
| 19 | Observability | **DONE** | structured logger, audit, journals, ops observability scripts |
| 20 | Security hardening | **DONE + hardened** | redaction/safe-output/capabilities + **S1-S7 patches** |
| 21 | Infra read adapters | **DONE (disabled)** | `ops-provider.ts` (`PILOT_OPS_PROVIDER=disabled`) |
| 22 | Level-6 remote-op framework (disabled) | **DONE (disabled)** | `ops-action-registry` real verbs `enabled:false`; `EXECUTOR_READY=false`; **S7 migration guard** |
| 23 | Client/business context | **PARTIAL** | tenant/resource commands; broader client model external |
| 24 | Documentation | **DONE (this pass)** | docs/migrapilot/* incl. this runbook + MISSION_EXECUTION |
| 25 | Packaging | **PARTIAL** | extension `.vsix` build exists; monorepo build scripts present |
| 26 | End-to-end tests | **PARTIAL** | eval/benchmark gates exist; behavioral e2e thin |
| 27 | Release gates | **DONE** | `docs/migrapilot/phase-36/*` go/no-go + soak templates; `ops:chat:gate:full` |

## Genuine remaining gaps (safe to build once on-host access exists)
1. **Semantic RAG in pilot-api** (#7/#8/#14) — wire real pgvector (schema has no vector column); currently keyword-only despite docstrings.
2. **Behavioral e2e coverage** (#26) — the phase-36 gate leans on evals, not behavioral tests.
3. **NL-mission → tool-runner** live wiring at scale — the mission-execution patch implements the executor + safe defaults; broadening `approvalGranted` resolution to the approval store is the next increment.

These are **backend changes to an untracked/unreachable repo** — they must be authored on-host, not fabricated here. Building them locally would produce unverifiable duplicates of a phase-36 system.

## What was NOT done, and why (honesty)
No duplicate implementations were created for subsystems marked DONE. Re-authoring
working phase-36 code as unverifiable patch-handoffs would violate the preserve /
no-rewrite / no-fake-completion rules. The correct next action is on-host application
of the three patches + on-host authoring of the three genuine gaps.
