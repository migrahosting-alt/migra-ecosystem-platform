# MigraPilot Safety Scaffold — Documentation Index (Phase 12.20)

> Consolidated map of the MigraPilot Phase-12 safety scaffold for human review. **Documentation only** —
> this index links existing artifacts; it implements no executor, enables no real action, and changes no
> eligibility/approval behavior. The machine-readable sources of truth live in `lib/pilot/*`; this page
> does not duplicate their logic.

## Current accepted posture (cold perimeter)

| property | value |
|---|---|
| Executor | **absent** |
| `EXECUTOR_READY` | **false** |
| `eligibleForExecution` | **hard-false** |
| Real ops actions | **disabled / blocked** (registry 4 enabled controlled / 5 disabled real) |
| `safe_read` tools | **approval-card-free** |
| Approval / eligibility hash / target fingerprint / approval comparison | **untouched** |
| Safe-read status/report/export/diagnostic/evidence surfaces | **redacted** |
| Source / code / repo paths | **intact** (never destructively redacted) |
| Shared monorepo CI/hooks | **untouched** |
| SDXL live generation | **`NEEDS_REAL_SD_ENDPOINT`** (separate track) |

## Canonical verification commands

```bash
npm run pilot:redaction:test     # redaction harness (31 checks)
npm run pilot:safety:verify      # safety-invariant manifest (10 machine-checked + 1 documented)
npm run pilot:precheck:verify    # executor precheck ↔ manifest/commands drift-guard + status/export/bundle reflection
npm run pilot:verify             # unified gate = redaction + safety (fail-closed)
npm run pilot:ci                 # tsc --noEmit && pilot:verify  ← canonical pre-merge gate
```

## Safety artifacts index

### Design gates (design-only)
- **Executor lifecycle** — [`ops-executor-design-phase-12-5.md`](./ops-executor-design-phase-12-5.md) (12.5): 17-stage lifecycle, 19 gates, forbidden list, journal events, 13 promotion gates.
- **Executor lock** — [`ops-executor-lock-design-phase-12-6.md`](./ops-executor-lock-design-phase-12-6.md) (12.6): scopes, statuses, fail-closed acquire/TTL/release, Postgres table sketch.
- **Audit report schema** — [`ops-executor-audit-report-schema-phase-12-8.md`](./ops-executor-audit-report-schema-phase-12-8.md) (12.8): 21 fields, 14 statuses, 16 sections, redaction/fail-closed rules.

### Redaction & safe-read export (implemented)
- **Redaction helper** — `lib/pilot/redaction.ts` (12.7) + harness `scripts/pilot/verify-redaction.ts` (`npm run pilot:redaction:test`).
- **Safe-read response wrapper** — `lib/pilot/safe-output.ts` `safeJson()` (12.9): journal/report/diagnostic routes redacted; code/approval/eligibility routes intentionally not wrapped.
- **Report export preview** — `lib/pilot/report-export.ts` (12.10): copy-safe markdown/json/text, fail-closed on residual secrets. Tool `ops.report.export_preview`.

### Invariant manifest & gates (implemented)
- **Safety invariant manifest** — [`ops-safety-invariants-phase-12-12.md`](./ops-safety-invariants-phase-12-12.md) (12.12) · `lib/pilot/safety-invariants.ts` (`SAFETY_INVARIANTS`, v12.12.0) · verifier `scripts/pilot/verify-safety-invariants.ts` (10 machine-checked + 1 documented).
- **Unified gate** — `scripts/pilot/verify-all.mjs` (12.13) → `npm run pilot:verify` (fail-closed composition).
- **Local CI gate** — [`ci-verification-phase-12-14.md`](./ci-verification-phase-12-14.md) (12.14) → `npm run pilot:ci`. (Shared monorepo CI/hooks intentionally not modified.)

### Executor precheck contract (implemented)
- **Pre-implementation checklist** — [`executor-preimplementation-checklist-phase-12-15.md`](./executor-preimplementation-checklist-phase-12-15.md) (12.15) · `lib/pilot/executor-precheck.ts` (`EXECUTOR_PRECHECKS`, `EXECUTOR_READY=false`, v12.15.0) · drift-guard `scripts/pilot/verify-executor-precheck.ts` (`npm run pilot:precheck:verify`). **24 blocking prechecks: 12 standing satisfied, 12 promotion pending.**

### Read-only human-review surfaces (implemented)
- **Promotion gate status** — `lib/pilot/promotion-status.ts` (12.16) · `GET /api/pilot/ops/promotion-status` · tool `ops.promotion.status` · Ops "Promotion gate status" panel.
- **Promotion status export preview** — `POST /api/pilot/ops/promotion-status/export/preview` (12.17) · tool `ops.promotion.export_preview` (reuses the report-export engine).
- **Promotion evidence bundle** — `lib/pilot/promotion-evidence.ts` (12.18) · `GET /api/pilot/ops/promotion-evidence` · tool `ops.promotion.evidence` (status + manifest + precheck + commands + `noExecutionAttestation`).
- **Evidence bundle export preview** — `POST /api/pilot/ops/promotion-evidence/export/preview` (12.19) · tool `ops.promotion.evidence_export_preview`.

All status/export/evidence tools + routes are **`safe_read`**, create **no approval card**, write **no file**, and keep `executed/written/eligibleForExecution` false.

## Standing gap

**`NEEDS_REAL_SD_ENDPOINT`** — SDXL live image generation is unproven until an endpoint is configured (`PILOT_IMAGE_PROVIDER=sdxl` + `PILOT_IMAGE_ENDPOINT`). It is a **separate track**, not an executor promotion gate. The image provider is disabled by default; `image.generate` remains `requires_approval`, `image.health`/`image.preview` remain `safe_read`.

## Promotion rule

An executor may be implemented **only** in a future, human-approved phase that (1) keeps all standing prechecks green (`npm run pilot:ci`), (2) satisfies **every** promotion precheck in the 12.15 checklist, and (3) flips `EXECUTOR_READY` to `true` as an explicit reviewed change. Until then the perimeter stays cold and the read-only surfaces above are the operator's review path.
