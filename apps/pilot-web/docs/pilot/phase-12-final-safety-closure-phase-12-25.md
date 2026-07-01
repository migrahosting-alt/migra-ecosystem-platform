# MigraPilot Phase 12 — Final Safety Closure Report (Phase 12.25)

> **Documentation only.** This is the closure/handoff summary of the Phase-12 safety scaffold. It
> implements no executor, enables no real action, and changes no eligibility/approval behavior. It
> records the completed work, the current cold posture, the canonical verification commands, and the
> exact conditions required before any future executor-adjacent (Phase 13+) work.
>
> Index: [`README.md`](./README.md) · run everything with `npm run pilot:ci`.

## 1. Phase range summarized: 12.5 → 12.24

| Phase | Deliverable | Kind |
|---|---|---|
| **12.5** | Executor lifecycle design (17 stages, 19 gates, forbidden list) | design |
| **12.6** | Executor lock design (scopes, statuses, fail-closed, table sketch) | design |
| **12.8** | Executor audit-report schema (21 fields, 14 statuses, 16 sections) | design |
| **12.7** | Redaction helper `redaction.ts` + harness (`pilot:redaction:test`) | impl |
| **12.9** | Safe-read redaction wiring (`safe-output.ts`/`safeJson` on journal/report/diagnostic routes) | impl |
| **12.10** | Safe-read report export preview (`report-export.ts`, fail-closed) | impl |
| **12.11** | Real SDXL endpoint live test → **not configured** (`NEEDS_REAL_SD_ENDPOINT`); safety envelope verified | verify |
| **12.12** | Ops-safety invariant manifest (`safety-invariants.ts` v12.12.0) + verifier (`pilot:safety:verify`) | impl |
| **12.13** | Unified verifier `verify-all.mjs` → `pilot:verify` (fail-closed) | impl |
| **12.14** | Local CI gate `pilot:ci` (`tsc --noEmit && pilot:verify`) | impl |
| **12.15** | Executor pre-implementation checklist (`executor-precheck.ts`, 24 prechecks, `EXECUTOR_READY=false`) + `pilot:precheck:verify` | impl |
| **12.16** | Promotion gate status dashboard (`promotion-status.ts`, route, tool, UI) | impl |
| **12.17** | Promotion status export preview | impl |
| **12.18** | Promotion evidence bundle (`promotion-evidence.ts`, `noExecutionAttestation`) | impl |
| **12.19** | Evidence bundle export preview | impl |
| **12.20** | Consolidated safety docs index (`README.md`) | docs |
| **12.21** | Scoped repo-root CI proposal (docs-only) | docs |
| **12.22** | Applied scoped CI workflow `.github/workflows/migrapilot-pilot-web-gate.yml` | infra (approved) |
| **12.23** | Committed `package-lock.json` + switched CI to `npm ci` (deterministic) | infra (approved) |
| **12.24** | CI posture surfaced in evidence bundle (`CI_POSTURE`/`ciPosture`) + verifier match | impl |

## 2. Current accepted posture (cold perimeter)

- **Executor: absent** · `EXECUTOR_READY: false` · `eligibleForExecution: hard-false`.
- **Real ops actions: disabled / blocked** (registry 4 controlled-enabled / 5 real-disabled; policy blocks all real verbs).
- **`safe_read` tools: approval-card-free**; requires_approval tools are internal-only (no real infra work).
- **Approval / eligibility hash / target fingerprint / approval comparison: untouched.**
- **Safe-read status/report/export/diagnostic/evidence surfaces: redacted** (fail-closed on residual secrets).
- **Source / code / repo paths: intact** (never destructively redacted).
- **Scoped CI: applied, deterministic (`npm ci`), read-only (`contents: read`), path-filtered to `apps/pilot-web/**`**; shared monorepo CI/hooks otherwise untouched.
- **SDXL live generation: `NEEDS_REAL_SD_ENDPOINT`** (separate track; provider disabled by default; `image.generate` requires_approval, `image.health`/`image.preview` safe_read).

## 3. Canonical verification commands

```bash
npm ci                           # deterministic install (committed lockfile)
npm run pilot:redaction:test     # redaction harness (31 checks)
npm run pilot:safety:verify      # safety-invariant manifest (10 machine-checked + 1 documented)
npm run pilot:precheck:verify    # executor precheck ↔ manifest/commands/status/export/bundle/CI drift-guard
npm run pilot:verify             # redaction + safety (fail-closed)
npm run pilot:ci                 # tsc --noEmit && pilot:verify  ← canonical gate (local + GitHub Actions)
```

## 4. Future executor promotion conditions (ALL required before any executor work)

An executor may be built **only** in a future, separately-approved Phase-13+ that satisfies every one of these (mirrors `EXECUTOR_PRECHECKS`, `EXECUTOR_READY` stays false until the last step):

1. **Explicit human approval** (Bonex) to begin executor implementation.
2. **All 24 prechecks satisfied** (12 standing still green + 12 promotion flipped with evidence).
3. **`EXECUTOR_READY` deliberately flipped to `true`** as an explicit, reviewed change.
4. **Dev target allowlist finalized** — a real dev-only target via `PILOT_OPS_TARGET_ALLOWLIST_JSON` (production never eligible).
5. **≥1 safe dev-only real-action candidate** in the registry (currently zero).
6. **Postgres approvals + ops journal verified in the target environment** (persistent, exact-once, append-only).
7. **Executor lock storage implemented** per the 12.6 design (fail-closed acquire/TTL/release).
8. **Rollback runbook + health verification tested** for the candidate action (no auto-rollback).
9. **Audit-report schema implemented** per 12.8 (redacted, fail-closed).
10. **Safe-read / report redaction remains green** (`npm run pilot:ci` passes throughout).

Until all of the above hold, the perimeter stays cold and the read-only status/evidence/export surfaces are the operator's review path.

## 5. Remaining gaps / open items

- **`NEEDS_REAL_SD_ENDPOINT`** — image generation unproven until an endpoint is configured (separate track, not an executor gate).
- **No dev real-action candidate** exists yet (all real verbs disabled by design).
- **Postgres approvals/journal** verified against a dev DB in 12.1; must be re-verified in the actual target environment before promotion.
- **Executor + lock + audit-report generator** remain design-only (12.5/12.6/12.8).

## 6. Handoff statement

Phase 12 delivered a complete, machine-checkable, CI-gated safety scaffold around a **deliberately absent executor**. Every real-action path is blocked or design-only; every human-review surface is read-only and redacted; the whole posture is enforced by `npm run pilot:ci` locally and in a scoped GitHub Actions workflow. No Phase-13 / executor-adjacent work should begin without satisfying §4.
