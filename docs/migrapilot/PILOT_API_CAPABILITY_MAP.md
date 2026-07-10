# services/pilot-api — Capability Map (2026-07-10)

Deep-map of the 38k-line backend, from 4 parallel read-only inspection passes. Purpose:
decide the canonical MigraPilot backend and identify the real work.

## Verdict: this is the canonical backend

`services/pilot-api` is unambiguously the production engine. It has, verified by
inspection, everything the other two backends lack:

| Capability | pilot-api | pilot-web/lib/pilot | brain-service |
|---|---|---|---|
| LLM providers | **Anthropic 3-tier (haiku/sonnet/opus) + local vLLM/Ollama**, router, circuit breaker, budget caps, prompt caching | Ollama only | all StubProvider |
| Persistence | **Postgres, 66 models, 10 migrations** | in-memory + file (PG opt-in) | in-memory |
| Auth | **JWT + bcrypt Operator model + capability RBAC + helmet + rate-limit** | 2/44 routes | none |
| Approval/idempotency | **HMAC tokens + PilotIdempotency (exactly-once) + append-only AuditLog** | 4-level, in-memory | none |
| Autonomous ops | **engineeringOs v2: missions, worker w/ leader election, state machine, drift, incidents** | ops framework (disabled) | none |
| Real executor | **tool-runner → live MigraPanel HTTP mutations** | blocked | ungated editApply |
| Eval suite | **~55-assertion harness + integration replay/benchmark gates** | verifier scripts | 3 vitest files |

Recommendation: **pilot-api = canonical backend; pilot-web = its frontend** (per
ARCHITECTURE.md, SSE/REST). brain-service + the two extensions → reconcile/retire.

## What's REAL (do not rebuild)
- **LLM stack** — `services/llm/`: real Anthropic (`claudeProvider.ts`), local vLLM (`localOpenAIProvider.ts`), Ollama (`ollamaProvider.ts`); router with forced/opus/sonnet/local fallback + cost caps; circuit breaker (3 fails/60s). Keys from env. `vllmProvider.ts` is dead code.
- **Agent loop** — `agentLoop.ts` (3695 L): 15-iteration cap, tool-runner execution, parallel reads / sequential writes, HMAC approval-token pause → `PENDING_APPROVAL`, idempotency replay, read-only degraded mode, deterministic preflight fast-paths.
- **engineeringOs v2** — active autonomous-ops engine: 7 typed missions (M1–M7), Prisma-backed `MissionRun`, lease-guarded tick, per-env state machine (NORMAL→CAUTION→READ_ONLY), local/remote adapters (real subprocess `node ./bin/migra.mjs`), approval CAS + "Approve Always" grants, drift, incident correlation.
- **Worker** — standalone/embedded, distributed leader election, 4 loops (autonomy 30s, drift 300s, mission 15s, notifications 5s) + retention cleanup.
- **Data** — 66 Postgres models grouped: conversations/runs, approvals/idempotency, audit, missions/autonomy, drift, ops/incidents, playbooks/promotions, notifications/presence, commands/policy, infra/resource-graph, state snapshots.
- **Auth** — `Operator` (bcrypt, role admin/operator/viewer), 7-day JWT, `requireAuth`/`requireAuthOrDev` (prod-safe dev bypass), capability RBAC (`security/routeGuard.ts`), helmet + tiered rate-limiters in `app.ts`.
- **Audit** — append-only (`auditLog.create` only; no update/delete anywhere), Postgres-persisted.
- **Eval** — `src/eval/harness.ts` ~55 assertions (schema, tenancy, danger/policy, router, injection, redaction, breaker, tickets) + `scripts/evals/*` integration replay + benchmark gates.
- **Notifications** — router → in-app/desktop/email(HTTP relay)/webhook(Slack/Discord); dedupe, quiet-hours, rate-limit, SSE.

## Material STUBs / gaps (the real backlog)
1. **NL-mission task execution** — `worker/missionWorker.ts:118-121` marks steps done with `// TODO: Execute via tool-runner`; Tier-3 auto-exec hardcoded `return false`. The autonomous ops missions (v2) execute for real; the NL-goal "engineering missions" do not yet.
2. **RAG is not semantic** — `rag/ragPipeline.ts` docstring claims pgvector but stores chunks in `AuditLog` and does keyword TF scoring; embeddings fetched but never used. Memory (`memory/memoryService.ts`) reuses `AuditLog` as KV, no embeddings.
3. **Change tickets are in-memory** — `changeTicketService.ts:77` Map (cap 500); only lifecycle events persist to audit. Non-durable.
4. **Two parallel approval systems** — `approvalService`/`PilotApproval` (wired to tool gate) vs `executionApprovals`/`ExecutionApproval` (run pause/resume). Needs reconciliation.
5. **Test coverage** — 7 vitest files (~53 cases); bulk of assurance is the custom harness, not unit tests. Thin for a release gate.
6. **V1 Tier≥2 approval** — `orchestrator/pilot.ts:187` hard-denies "not yet implemented in V1"; superseded by agentLoop path.

## SECURITY FINDINGS (verified against source — hardening before release gate)
The executor (`services/tool-runner/.../handlers.ts`) makes **real MigraPanel mutations**
(pods/dns/mail/domains/wordpress/storage create+delete). Gating is real but has holes:

| # | Finding | Evidence | Risk |
|---|---|---|---|
| S1 | **Self-service approval** — `POST /approvals/:id/approve` sets APPROVED + mints token with no approver≠requester, no status/expiry check | `routes/approvals.ts:34-44` | No separation of duties; a requester can approve their own mutation |
| S2 | **Default HMAC approval secret** — falls back to `"dev-approval-secret-change-me"` if env unset | `approvalService.ts:8` | Approval tokens forgeable in any env missing `APPROVAL_SIGNING_SECRET` |
| S3 | **Unauthenticated admin route** — breaker force-flip + provider usage stats, no auth | `app.ts:246`, `admin.ts` (0 `requireAuth`) | Anyone can flip circuit breakers / read usage |
| S4 | **Unauthenticated tickets route** — change-ticket approve/apply, no auth | `app.ts:252`, `tickets.ts` (0 `requireAuth`) | Unauthenticated change approval |
| S5 | **Superadmin/owner bypass** — skip approval, idempotency, AND denylists | `agentLoop.ts:3228,3231`, `safetyPolicy.ts:48` | A compromised owner token = unchecked prod mutation |
| S6 | **Orchestrator defaults `dryRun=false`** (chat defaults true) | `orchestrator/pilot.ts:143` vs `routes/chat.ts:201` | Non-chat entrypoints execute for real by default |
| S7 | **`go-live.mjs` runs real `prisma migrate deploy`** with no dry-run guard; automated rollback is `[Future]` stub | `scripts/ops/go-live.mjs:290,119-123` | Real DB schema mutation; no auto-rollback |

These are the concrete meaning of gap #3 (auth/security) from the consolidation analysis.
Note: the safety **posture** is otherwise strong (dryRun defaults on chat, append-only
audit, policy engine, capability RBAC) — these are gaps in an otherwise mature design,
not an absence of safety.

## Recommended first hardening checkpoint (post decision)
S1–S4 are small, high-value, verifiable fixes on the canonical backend:
- S1: enforce approver≠requester + status==PENDING + not-expired in the approve handler.
- S2: fail closed if `APPROVAL_SIGNING_SECRET` unset in production.
- S3/S4: mount `admin` + `tickets` behind `requireAuth` (+ capability for admin).
Each is testable and aligns with the phase-36 release gate.
