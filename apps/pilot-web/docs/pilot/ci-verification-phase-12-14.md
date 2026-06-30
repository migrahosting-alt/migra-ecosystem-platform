# MigraPilot CI / Verification Gate (Phase 12.14)

> Wires the unified safety gate ([Phase 12.13](./), `npm run pilot:verify`) into a single canonical
> verification command for `apps/pilot-web`. **Composition-only** — it runs the existing read-only
> verifiers; it changes no runtime behavior, eligibility, approval semantics, or execution posture.

## Canonical command

```bash
cd apps/pilot-web
npm run pilot:ci
```

`pilot:ci` = `tsc --noEmit && npm run pilot:verify`, where `pilot:verify` runs:
1. `pilot:redaction:test` — redaction harness (31 checks)
2. `pilot:safety:verify` — safety-invariant manifest (10 machine-checked + 1 documented)

**Fail-closed:** the `&&` chain stops on the first failure, and `pilot:verify` itself exits non-zero if either child verifier fails. A typecheck error, a redaction regression, or any safety-invariant violation fails the gate.

**Read-only:** no env, no network, no DB, no SDXL, no pgvector, no external services, no generation/write/export — only typecheck + the two in-repo read-only verifiers.

## Why no GitHub Actions workflow / husky change was made

This is intentional and scoped:
- The monorepo-root `.github/workflows/*` and the shared `.lintstagedrc.json` / `.husky/` hooks are **shared infrastructure** across the whole MigraTeck ecosystem. Modifying them would affect other apps' CI/commits — outside the MigraPilot `apps/pilot-web` perimeter.
- **No existing workflow references `apps/pilot-web`** (`migrapilot-enterprise-gate.yml` targets the unrelated `services/pilot-api`).
- Per the phase's own guidance, when there is no app CI workflow, the correct move is a **minimal local-only verification command path** rather than inventing a deployment pipeline.

## If/when a repo-root CI job is added for pilot-web

A future, separately-approved, narrowly-scoped workflow (triggered only on `apps/pilot-web/**`) should call the command above — it must not duplicate verifier logic:

```yaml
# illustrative only — NOT added in this phase
- name: MigraPilot safety gate
  working-directory: apps/pilot-web
  run: npm run pilot:ci
```

Until then, `npm run pilot:ci` is the documented pre-merge / pre-push safety gate for `apps/pilot-web`.
