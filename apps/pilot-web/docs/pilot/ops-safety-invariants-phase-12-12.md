# MigraPilot Ops-Safety Invariant Manifest (Phase 12.12)

> **Design freeze, v12.12.0.** This is the machine-checkable record of MigraPilot's current safety
> posture. It enables nothing and changes no behavior — it exists so future phases have a hard
> regression target and cannot weaken the executor perimeter by accident.
>
> - **Machine-readable manifest:** [`lib/pilot/safety-invariants.ts`](../../lib/pilot/safety-invariants.ts) (`SAFETY_INVARIANTS`, `SAFETY_INVARIANTS_VERSION`)
> - **Verifier (read-only):** [`scripts/pilot/verify-safety-invariants.ts`](../../scripts/pilot/verify-safety-invariants.ts) → `npm run pilot:safety:verify`
> - **Companion designs:** executor [12.5](./ops-executor-design-phase-12-5.md) · lock [12.6](./ops-executor-lock-design-phase-12-6.md) · audit schema [12.8](./ops-executor-audit-report-schema-phase-12-8.md) · redaction harness ([12.7](./), `npm run pilot:redaction:test`)

## How to run

```bash
npm run pilot:safety:verify     # checks the manifest against the live policy/registry/tool/route posture
```
The verifier is **read-only**: no env, no network, no DB, no external services — it reads only in-repo source + pure functions. It exits non-zero on any violation (a CI/regression gate).

## Invariants

| id | severity | machine-checkable | invariant |
|---|---|---|---|
| `executor-absent` | critical | ✅ | No real-action executor module (`lib/pilot/*executor*`) or executor tool exists. |
| `eligible-for-execution-hard-false` | critical | ✅ | `checkEligibility` / `previewEligibility` always return `eligibleForExecution:false`. |
| `real-ops-actions-disabled` | critical | ✅ | Every real ops verb is registry-`disabled` **and** policy-`blocked`; only controlled `noop`/`status_marker`/`webhook_sim` are enabled (4 enabled / 5 disabled). |
| `safe-read-no-approval` | high | ✅ | `safe_read` tools never `requiresApproval` (no approval card). |
| `requires-approval-internal-only` | high | ✅ | `requires_approval` tools (`noop`/`status_marker`/`webhook_sim`) gate, but perform no real infrastructure work. |
| `approval-eligibility-paths-not-redaction-wrapped` | high | ✅ | Approval / eligibility / target / preflight routes are **not** `safeJson`-wrapped (preserves hash + evaluation integrity). |
| `safe-read-surfaces-redacted` | high | ✅ | Report / journal / diagnostic / export safe-read routes pass output through `safeJson`. |
| `code-paths-not-redacted` | high | ✅ | Source / code / repo / prompt routes are **not** redaction-wrapped (no content corruption). |
| `image-generate-approval-gated` | high | ✅ | `image.generate` is `requires_approval`. |
| `image-diagnostics-safe-read` | medium | ✅ | `image.health` and `image.preview` are `safe_read`. |
| `sdxl-live-unproven-unless-configured` | medium | 📄 (manual) | SDXL live generation is unproven; the image provider is disabled by default until an endpoint is configured (`NEEDS_REAL_SD_ENDPOINT`). |

## What is captured vs. not machine-checkable

- **10 invariants are machine-checked** by the verifier against live `policy.ts` classifications, the `ops-action-registry`, `ops-eligibility-policy`, the `TOOLS` map, `lib/pilot/` filenames, and the import posture of the API route files (which safe-read routes do / don't wrap `safeJson`).
- **1 invariant is documented-manual** (`sdxl-live-unproven-unless-configured`): it is environment/endpoint-dependent (a live SDXL endpoint would be required to prove generation), so it is recorded as a standing fact (`NEEDS_REAL_SD_ENDPOINT`) rather than a code check. The verifier prints it as `DOC`.

## Scope of this phase

This phase adds **only** the manifest, the verifier, the `pilot:safety:verify` script, and this document. It implements **no executor**, enables **no real action**, and changes **no** policy / eligibility / approval / hash / target-fingerprint behavior. The verifier itself mutates nothing. Bumping `SAFETY_INVARIANTS_VERSION` and adding/removing entries is the intended way to evolve the frozen posture deliberately in future phases.
