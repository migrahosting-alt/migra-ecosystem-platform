# MigraPilot — Consolidation Gap Analysis (2026-07-10)

Grounded in repository inspection, not the roadmap's assumptions. Purpose: turn the
30-phase "build end to end" request into a real, ranked backlog against what already
exists.

## Headline

The 30-phase roadmap is **largely already implemented**, at documented **phase-36
release-gate**. The work is **consolidation + stabilization + hardening**, not
greenfield feature-building. Generating new subsystems would duplicate mature code and
create fresh competing implementations.

## Surfaces discovered

### Backends (three, divergent)
| Surface | Size | Tests | Providers | Storage | Status |
|---|---|---|---|---|---|
| `services/pilot-api/` | 38,205 L / 178 f | 7 | vLLM + Anthropic (3-brain, per ARCHITECTURE.md) | Postgres/Prisma | Documented production backend. **Not yet deep-mapped.** |
| `apps/pilot-web/lib/pilot/` | 6,420 L / 31 f | 0 | **Ollama only** | in-memory + file (PG opt-in) | Working Next.js route engine. Mapped in detail below. |
| `apps/brain-service/` | 1,077 L / 16 f | 3 | **all StubProvider (canned text)** | in-memory | Unfinished scaffold for `vscode-extension`. |

### Extensions (retired down to one canonical)
- `apps/vscode-extension` → `migrapilot-extension` v0.1.0 — **canonical**, Chat-API + brainClient.
- `apps/migrapilot-vscode` v0.0.4 — RETIRED (a4ddc45).
- `apps/migrapilot-vscode-extension` v0.4.2 — RETIRED (a4ddc45).

### Operational facts
- `apps/pilot-web` is a **nested git repo** (`redesign/pale-control-center`) with **424 uncommitted files** — a redesign in flight.
- Root repo remotes: `origin` (github migra-ecosystem-platform), `core` (on-host), `web` (MigraTeck-web).
- Pre-commit: husky + lint-staged with a live secret-scanner; catch-all `.gitignore` (`*`) needs `git add -f` for new source.

## Roadmap → reality (pilot-web engine mapped by inspection)

Legend: DONE · PARTIAL · GATED-OFF (intentional safety) · STUB · MISSING

| Roadmap phase | Status | Evidence |
|---|---|---|
| P2 Provider layer | PARTIAL | pilot-web Ollama-only (`gateway.ts`); pilot-api has Anthropic+vLLM; brain-service stubs. No unified provider abstraction across the three. |
| P3 Orchestrator | DONE | `orchestrator.ts` tool loop, auto-run reads, pause-for-approval, stream. |
| P5 Patch review | DONE | `tools.ts` code.preview; DiffViewer (pilot-web components). |
| P6/7 Edit preview / approved apply | DONE (pilot-web) / HAZARD (brain-service) | pilot-web `code.apply` gated by 4-level policy; **brain-service `editApply.ts:48` writes with no gate**. |
| P9 Git assistant | DONE | git.status/diff/log tools; extension `generateCommit`. |
| P10 Repo intelligence | PARTIAL | pilot-web real embeddings/RAG (`knowledge.ts`, `nomic-embed-text`); brain-service lexical-only, `repoMapReady/symbolIndexReady=false`. No symbol/route index. |
| P11 Multi-project registry | DONE (static) | `project-registry.ts` ~11 projects w/ hazards/safe/forbidden cmds. Static data, not DB-driven. |
| P12 Web command center | DONE | 44 `/api/pilot/*` routes; PilotShell/Admin/CommandPalette. |
| P13 Specialized agents | DONE | pilot-api `services/agents/` (planner/reviewer/tool/summarizer/incident). |
| P14 Tool registry | DONE | `tools.ts` ~40 tools + `packages/tooling/tools.registry.json` (30). |
| P15 Memory | DONE | `knowledge*.ts` ingest→chunk→embed→search, file-persistent + pgvector opt-in. |
| P16 Approvals | DONE | 4 levels (`policy.ts`), server-enforced + re-enforced at execute, atomic exact-once `claimApproval`, TTL. |
| P17 Task automation / persistent state | PARTIAL | orchestrator runs multi-step; **run/conversation/audit store is ephemeral (`store.ts` globalThis, resets on restart)**. |
| P19 Evaluations | PARTIAL | `scripts/pilot/eval-*`, EVALS.md; verifier scripts. No behavioral unit tests. |
| P20 Observability | DONE | structured logger, audit records, journals. |
| P21 Security hardening | PARTIAL/GAP | redaction/safe-output/safety-invariants DONE; **auth is the gap — 42/44 pilot-web routes unauthenticated**; only `/assistant*` bearer-guarded. |
| P22 Infra read (L5) | GATED-OFF | `ops-provider.ts` full read framework, `PILOT_OPS_PROVIDER=disabled` default. Exactly as spec wants. |
| P23 Remote ops (L6) | GATED-OFF | `ops-action-registry` real verbs `enabled:false`; `EXECUTOR_READY=false`; `eligibleForExecution=false`. Exactly as spec wants. |

## Ranked REAL gaps (the actual backlog)

1. **Canonical-backend reconciliation** — 3 divergent backends (pilot-api 38k / pilot-web 6.4k / brain-service stub) with different provider stacks, storage, and approval code. No single source of truth. *Blocks everything; needs an owner decision + a mapping pass on `services/pilot-api`.*
2. **Land the 424-file pilot-web redesign** — feature work on an uncommitted in-flight redesign is unsafe. *Operational blocker.*
3. **Authentication/authorization** — 42/44 pilot-web routes have no authN; protection relies solely on action-classification. Roadmap P21 explicitly requires role-based access. *Security gap.*
4. **Behavioral test coverage** — canonical pilot-web engine has 0 unit tests across 6,420 lines; only the brain-service scaffold is tested. Team is at a release gate (phase-36) with almost no behavioral tests on the real engine. *Quality gap.*
5. **brain-service ungated `editApply`** — inconsistent with pilot-web's enforced model; either gate it or formally scope brain-service as retired scaffold. *Safety inconsistency.*
6. **Persistence-by-default** — runs/conversations/audit reset on restart (in-memory default). P17 persistent task state + P21 audit immutability want durable storage. *Durability gap.*
7. **Provider unification** — pilot-web (Ollama) vs pilot-api (Anthropic/vLLM) vs brain-service (stub). No shared provider abstraction. *Consolidation gap.*

## What is NOT a gap (already done, do not rebuild)
Orchestration, ~40-tool registry, 4-level approval with exact-once execution, redaction,
RAG + persistent memory with embeddings, multi-agent profiles, project registry, ops
read/remote framework (correctly disabled-by-default), promotion evidence, report export,
observability/audit.

## Recommended sequence (post canonical-backend decision)
1. Decide canonical backend (pilot-api vs pilot-web/lib/pilot) + deep-map the winner.
2. Land or quarantine the 424-file redesign; get a clean tree.
3. Add authN/authZ to the canonical routes (P21).
4. Add behavioral tests to the canonical engine to match the release gate (P19/P27).
5. Make persistence the default on the canonical backend (P17/P21).
6. Formally retire the non-canonical backend + brain-service scaffold.

## Honesty notes
- `services/pilot-api` (the largest surface) was sized but not deep-mapped; its detailed
  capability map is a prerequisite before declaring it canonical.
- "DONE" = present and wired by inspection; it does **not** assert release-quality or that
  every path was runtime-verified. Runtime verification is a separate, recommended step.
