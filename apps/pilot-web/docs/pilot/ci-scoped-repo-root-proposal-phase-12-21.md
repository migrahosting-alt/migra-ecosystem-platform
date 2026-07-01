# Scoped Repo-Root CI Proposal for `apps/pilot-web` (Phase 12.21)

> **PROPOSAL / DOCUMENTATION ONLY.** This is a reviewable spec for a *future* repo-root GitHub Actions
> workflow that runs `apps/pilot-web`'s safety gate. **Nothing is wired in this phase.** No
> `.github/workflows`, `.husky`, or lint-staged file is created or modified here; this phase changes no
> runtime behavior, eligibility, or approval semantics, and implements no executor.
>
> Wiring the workflow is a **separate, explicitly approved** step (a shared-infra change) — see §5.

## 1. Why this is a proposal, not a change

- The current gate `npm run pilot:ci` (Phase 12.14) is **pilot-web-local**: it lives entirely inside
  `apps/pilot-web` and touches no shared infrastructure.
- A GitHub Actions workflow that actually *runs on push/PR* must live at the **repo root**
  (`.github/workflows/`), which is **shared monorepo infrastructure** across the whole MigraTeck
  ecosystem. Editing it can affect unrelated apps' CI, so it is kept **out of the pilot-web perimeter**
  until deliberately approved.
- No existing workflow references `apps/pilot-web` (`migrapilot-enterprise-gate.yml` targets the
  unrelated `services/pilot-api`), so this would be a **new, additive, narrowly-scoped** workflow — not
  a modification of another app's CI.

## 2. Exact proposed future workflow (illustrative — NOT added in this phase)

```yaml
# .github/workflows/migrapilot-pilot-web-gate.yml   ← repo root; ADD later, separately approved
name: MigraPilot pilot-web safety gate
on:
  push:
    branches: [ main ]
    paths:
      - "apps/pilot-web/**"
      - ".github/workflows/migrapilot-pilot-web-gate.yml"
  pull_request:
    paths:
      - "apps/pilot-web/**"
permissions:
  contents: read            # read-only; no deploy, no write, no packages
concurrency:
  group: migrapilot-pilot-web-gate-${{ github.ref }}
  cancel-in-progress: true
jobs:
  pilot-ci:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: apps/pilot-web
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - run: npm ci        # or: npm install (repo convention)
      - run: npm run pilot:ci   # tsc --noEmit && pilot:verify (redaction + safety invariants)
```

### Exact command / path
- **working-directory:** `apps/pilot-web`
- **command:** `npm run pilot:ci`  (= `tsc --noEmit && npm run pilot:verify` → `pilot:redaction:test` + `pilot:safety:verify`)
- **triggers:** `push` to `main` + `pull_request`, both **path-filtered to `apps/pilot-web/**`** so it only runs when pilot-web changes.

## 3. Trigger / path-filter recommendation

- **Path filter `apps/pilot-web/**`** so the gate never runs for unrelated apps (and doesn't add CI time to their PRs).
- Include the workflow file itself in the `push` path filter so changes to the gate are self-validated.
- `pull_request` (no branch filter) so every PR touching pilot-web is gated before merge.
- `concurrency` with `cancel-in-progress` to avoid redundant runs on rapid pushes.

## 4. No external dependencies

`npm run pilot:ci` is fully self-contained and **must remain so**:
- **No** external services, network, DB, real env, SDXL, or pgvector.
- `pilot:redaction:test` + `pilot:safety:verify` read only in-repo source + pure functions and use fake fixtures.
- The only network the job needs is `npm ci` (dependency install) — no runtime/provider calls.
- `permissions: contents: read` — the job cannot deploy, push, or mutate anything.

## 5. Risk notes for shared monorepo CI changes

- **Shared surface:** `.github/workflows/` is repo-wide; a new file is additive but still a shared-infra edit — must be reviewed/approved as such (not under the pilot-web autonomy perimeter).
- **`apps/pilot-web` is gitignored at the dev root** and committed via `git add -f`; confirm the files are actually present in the GitHub repo before relying on path-filter triggers (they are, via force-add).
- **Runner cost / flakiness:** keep it path-filtered and read-only; `pilot:ci` is fast (typecheck + two in-memory verifiers).
- **No secrets:** the job needs none; do not add repo/org secrets to it.
- **Do not** fold pilot-web checks into another app's existing workflow — keep it a separate file to avoid coupling.

## 6. Rollback / removal guidance (for the future workflow)

- **Disable:** set the job/step to `if: false`, or comment out the `on:` triggers.
- **Remove:** delete `.github/workflows/migrapilot-pilot-web-gate.yml` — being a standalone, path-filtered file, removal affects nothing else.
- **Local gate is unaffected either way:** `npm run pilot:ci` continues to work as the documented pre-merge command (Phase 12.14) whether or not the CI workflow exists.

## 7. Current accepted posture (unchanged by this proposal)

- Executor **absent**; `EXECUTOR_READY:false`; `eligibleForExecution:false`.
- Real ops actions **blocked / disabled** (registry 4 controlled-enabled / 5 real-disabled).
- `safe_read` tools **approval-card-free**; approval/eligibility/hash/fingerprint paths **untouched**.
- Source/code/repo paths **intact**; safe-read surfaces redacted.
- Shared CI/hooks **untouched**; SDXL live generation **`NEEDS_REAL_SD_ENDPOINT`**.

## 8. Recommendation

Approve the addition of the single, path-filtered, read-only workflow in §2 as a **separate shared-infra
change** when ready. Until then, `npm run pilot:ci` remains the canonical local/pre-merge gate
(Phase 12.14) and this document is the exact, reviewed spec for the CI step.
