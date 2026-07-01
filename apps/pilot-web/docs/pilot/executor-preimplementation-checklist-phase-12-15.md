# MigraPilot Executor Pre-Implementation Checklist (Phase 12.15)

> **Documentation / config / verifier only.** This checklist maps the executor promotion gates
> (designs [12.5](./ops-executor-design-phase-12-5.md) / [12.6](./ops-executor-lock-design-phase-12-6.md) /
> [12.8](./ops-executor-audit-report-schema-phase-12-8.md)) and the standing safety invariants
> ([12.12](./ops-safety-invariants-phase-12-12.md)) into concrete, auditable preconditions.
>
> It **implements no executor, enables no real action, and changes no eligibility/approval behavior.**
> `EXECUTOR_READY` is hard-`false`: **no real executor may be implemented until every promotion
> precheck below is satisfied by an explicit, human-approved phase.**
>
> - **Machine-readable:** [`lib/pilot/executor-precheck.ts`](../../lib/pilot/executor-precheck.ts) (`EXECUTOR_PRECHECKS`, `EXECUTOR_READY`, `EXECUTOR_PRECHECK_VERSION = "12.15.0"`, `MANIFEST_VERSION_REF`)
> - **Consistency verifier (read-only, drift-guard):** [`scripts/pilot/verify-executor-precheck.ts`](../../scripts/pilot/verify-executor-precheck.ts) → `npm run pilot:precheck:verify`
> - **The safety *proof* is `npm run pilot:ci`** — this verifier only checks that the checklist stays in sync with the manifest + commands and that the executor is still declared not-ready.

## Standing safety prechecks (satisfied now — must stay green via `npm run pilot:ci`)

| id | requirement | evidenced by |
|---|---|---|
| `safe-read-redaction-complete` | Safe-read output passes through `redactPilotValue`. | `safe-read-surfaces-redacted` / `pilot:redaction:test` |
| `report-export-surfaces-redacted` | Report/journal/diagnostic/export safe-read surfaces redacted. | `safe-read-surfaces-redacted` |
| `safety-invariant-manifest-green` | Manifest verifies with 0 violations. | `pilot:safety:verify` |
| `pilot-verify-green` | Unified read-only gate passes. | `pilot:verify` |
| `pilot-ci-green` | Typecheck + unified gate passes. | `pilot:ci` |
| `eligible-for-execution-hard-false` | `eligibleForExecution:false` always. | `eligible-for-execution-hard-false` |
| `real-ops-actions-blocked` | Real ops verbs registry-disabled + policy-blocked. | `real-ops-actions-disabled` |
| `approval-eligibility-hash-untouched` | Approval/eligibility/target/preflight hash+eval paths not redaction-wrapped. | `approval-eligibility-paths-not-redaction-wrapped` |
| `approval-required-tools-nonexecuting` | `requires_approval` tools gate but do no real infra work. | `requires-approval-internal-only` |
| `code-paths-not-destructively-redacted` | Source/code/repo/prompt paths not redaction-wrapped. | `code-paths-not-redacted` |
| `executor-absent` | No executor module or tool exists. | `executor-absent` |
| `no-production-target-configured` | No production target eligible/configured. | 12.2 (production never eligible) |

## Promotion preconditions (PENDING — **all** required before any executor is implemented)

| id | requirement | source |
|---|---|---|
| `explicit-human-approval` | Bonex explicitly approves executor implementation. | future human-approved phase |
| `dev-target-allowlist-finalized` | A real dev-only target via `PILOT_OPS_TARGET_ALLOWLIST_JSON`. | 12.2 + operator config |
| `dev-real-action-candidate` | Registry has ≥1 safe dev-only real-action candidate (currently **zero**). | future registry promotion |
| `postgres-approvals-verified-target-env` | Postgres approval store verified in the target environment. | 12.1 (re-verify) |
| `postgres-journal-verified-target-env` | Postgres ops journal verified in the target environment. | 12.1 (re-verify) |
| `executor-lock-storage-implemented` | Execution-lock storage per the 12.6 table sketch. | 12.6 → impl |
| `redaction-wired-into-report-generator` | `redactPilotValue` wired into the audit-report generator. | 12.7/12.8 → impl |
| `audit-report-schema-implemented` | Executor audit report per 12.8, redacted + fail-closed. | 12.8 → impl |
| `rollback-runbook-tested` | Rollback/recovery runbook tested for the candidate action. | future dev test |
| `health-verification-tested` | Allowlisted health verification tested for the candidate action. | future dev test |
| `ui-approval-ux-reviewed` | Executor approval/warning UX reviewed. | future UI review |
| `sdxl-live-endpoint-separately-gated` | SDXL live generation is a **separate** track (`NEEDS_REAL_SD_ENDPOINT`), not an executor gate. | image track |

## Promotion rule

An executor may be implemented **only** in a future, separately-approved phase that:
1. keeps all **standing** prechecks green (`npm run pilot:ci`),
2. satisfies **every** promotion precheck above (flipping each to `satisfied` deliberately, with evidence), and
3. flips `EXECUTOR_READY` to `true` as an explicit, reviewed change.

Until then this checklist is a **cold-perimeter contract**: the consistency verifier fails if the checklist drifts from the manifest version or references missing commands, or if the executor is ever silently marked ready. It does not (and must not) enable anything.
