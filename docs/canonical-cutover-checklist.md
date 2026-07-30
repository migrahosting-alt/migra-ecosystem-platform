# Default-branch cutover checklist — `main` → `phase-1/canonical-vscode-extension`

**Status: NOT EXECUTED.** No default-branch change, rename, protection change, or historical branch
deletion has been performed.

Prepared 2026-07-30 against canonical `b68eadc`. **Revised** after the cutover-readiness
investigation, which disproved several claims in the first draft — corrections are marked below and
the superseded numbers are stated rather than quietly replaced.

---

## 1. Verified preconditions

| # | Condition | Evidence | State |
|---|---|---|---|
| 1.1 | Canonical contains **both** histories | `6ec2e7e` and `528be820` are both ancestors of `b68eadc` | ✅ |
| 1.2 | `main` is an ancestor of canonical | fast-forward remains possible later | ✅ |
| 1.3 | Reconciliation merged deliberately | PR **#132** MERGED 2026-07-30T21:57:33Z → `b68eadc` | ✅ |
| 1.4 | `universal-required-gates.yml` targets both branches | `[main, phase-1/canonical-vscode-extension]` | ✅ |
| 1.5 | No duplicate check-context names | every job name emitted on canonical is unique | ✅ |
| 1.6 | Ruleset `20017185` active | 0 bypass actors, sole required context `canonical-integration-gate` | ✅ |
| 1.7 | Direct push / force-push / deletion blocked | proven by live attempts on a disposable mirror | ✅ |
| 1.8 | Documentation-only PR safe | probe #133 — §2 | ✅ |
| 1.9 | Unrelated-path PR safe | probe #134 — §2 | ✅ |
| 1.10 | PR #91 content already represented | removals are a no-op on canonical; ignore rule redundant | ✅ |
| 1.11 | PR #93 superseded | its head `6ec2e7e` is an ancestor of canonical | ✅ |
| 1.12 | Every required context triggers on canonical PRs | 10/10 verified; **none main-exclusive** | ✅ |
| 1.13 | Rollback documented | §5 | ✅ |

## 2. Probe context matrix

Both probes ran against the post-reconciliation gate table.

| context | docs-only (#133) | unrelated-path (#134) |
|---|---|---|
| `guard-bootstrap`, `fresh-clone-proof`, `nginx-gate`, `Workspace Hygiene (Strict)`, `validate`, `secret-scan` | applicable → success | applicable → success |
| `canonical-platform-validate`, `canonical-platform-secret-scan`, `extension` | not applicable | not applicable |
| `pale-validate`, `pale-backend-checks`, `pale-mobile-checks`, `pilot-ci` | dormant | dormant |
| **`canonical-integration-gate`** | **SUCCESS** | **SUCCESS** |

6 applicable / 3 not applicable / 4 dormant. No context left indefinitely expected. Neither merged;
both branches deleted.

## 3. Corrections to the first draft

### 3.1 ❌ RETRACTED — "seven workflows would silently stop deploying"

The first draft called this the highest-impact blocker. **It was wrong on both the count and the
consequence.**

- The count is **six**, not seven. `release-check` is `pull_request`-triggered, not `push`, and was
  wrongly included.
- **None of those workflows exists on `main`.** All seven files (six push-bound plus
  `release-check`) live only on canonical. GitHub reads workflows from the ref being pushed, so a
  `push: [main]` trigger inside a canonical-only file **can never fire**. Confirmed: **0 push runs,
  ever**, across all six.
- The two that actually deploy — `pale-staging-deploy` (Fly, `environment: staging`) and
  `pale-staging-backend` (deploy hook) — are additionally scoped to `Software/Pale/**`, and
  `Software/` has **0 tracked files** (every `Software/*` is an untracked nested repo). They have
  **never run at all**.

**There is no deployment to lose, and duplicate-deployment risk is structurally zero.** Widening
these does not restore anything; it would *add* validation that has never existed.

### 3.2 Classification of the six push-bound workflows

| workflow | scope tracked? | classification | action |
|---|---|---|---|
| `migrateck-platform-ci.yml` | `MigraTeck/**` — 1456 files | **widen-before-cutover** | canonical added to `push.branches` |
| `workspace-hygiene-gate.yml` | no path filter | **widen-before-cutover** | canonical added to `push.branches` |
| `pale-staging-deploy.yml` | `Software/Pale/**` — **0 files** | **manual-only** | not widened; `workflow_dispatch` added |
| `pale-staging-backend.yml` | `Software/Pale/**` — **0 files** | **manual-only** | not widened; already had `workflow_dispatch` |
| `migrapilot-enterprise-gate.yml` | `services/pilot-api/**` — **0 files** | **keep-main-only-during-stabilization** | none |
| `migrapilot-pilot-web-gate.yml` | `apps/pilot-web/**` — 122 files, but `pilot-ci` is structurally broken and dormant | **keep-main-only-during-stabilization** | none |

`migrapilot-extension.yml` already uses `push: [main, phase-*/**]` and needs nothing.

Deployment authority is deliberately **not** acquired as a side effect of a default-branch change.

### 3.3 `release-check` — DEFERRED with a named blocker

Not widened. Named blocker: it runs `node release-check.js ./docs/migrapilot/phase-36 36`, and
**neither the entrypoint nor its argument is tracked** (`release-check.js` tracked: 0;
`docs/migrapilot/phase-36` tracked: 0). Every CI checkout fails `MODULE_NOT_FOUND` before doing any
work — the same defect class as `pilot-ci`. It has never passed.

Resolve by one of: track both paths and prove a clean-clone pass, then target canonical · retire
with a recorded replacement · keep manual/informational. **Do not make it required.**

### 3.4 Everything protective keys off literal branch names

| item | binding |
|---|---|
| ruleset `20017185` | `refs/heads/phase-1/canonical-vscode-extension` |
| `canonical-integration-gate.yml` | `pull_request.branches: [phase-1/canonical-vscode-extension]` |
| `universal-required-gates.yml` | `[main, phase-1/canonical-vscode-extension]` |

Cutover is safe — the ref name does not change. **A later rename of canonical to `main` drops
protection and gating unless all three are updated first.** Keep the two-branch list until after
cutover *and* any rename.

### 3.5 The default branch will require 0 approvals

Canonical's ruleset sets `required_approving_review_count: 0` (deliberate interim — no independent
reviewer exists). `main` nominally requires 1, but that was satisfiable only from an account under
the same operator. Nothing substantive is lost; it should still be an explicit acceptance.

### 3.6 ⚠️ CORRECTED — scanner findings: **86**, not ~14

The first draft said "~14". That came from reading only the truncated tail of a CI log. The true
count against `main` as base is **86**. Audited by category — no values are reproduced here:

| category | count | verdict |
|---|---|---|
| `MigraTeck/test/integration/*.integration.test.ts` — `hardcoded-password` | ~66 | **safe fixtures** — integration-test credentials |
| `apps/brain-service/test/{redaction,agentModeCommand}.test.ts` | 5 | **safe fixtures** — tests that redaction works must contain secret-shaped input |
| `apps/pilot-web/scripts/pilot/verify-redaction.ts` | 3 | **safe fixture** — the redaction verifier itself |
| `apps/pilot-web/migrations/{README.md,0001_*.sql}` | 3 | **documentation** — example connection strings |
| CI workflow env (`migrapilot-enterprise-gate`, `pale-backend-ci`) | 3 | **safe** — throwaway localhost test DSNs |
| `MigraTeck/apps/web/src/app/console/lib/{db,pale-db}.ts` | 2 | **safe** — inside comments; 4-char placeholder tokens |
| `docs/migrapilot/patches/*.patch`, `infra/.../MAIL_SERVER_RUNBOOK.md` | 2 | **documentation** |
| `apps/vscode-extension/src/services/pilotConfigVscode.ts:16` | 1 | **safe — false positive** (below) |
| `MigraTeck/apps/auth-api/src/config/env.ts:32` | 1 | **unresolved — low risk**: localhost dev default DSN embedding a placeholder-shaped credential |
| `infra/enterprise/mail/validate-mail-configs.sh:174` | 1 | **unresolved — review**: 8-char literal in a Dovecot `sed` fix-up |

**`pilotConfigVscode.ts:16` resolved by manual inspection, as required.** `const SECRET_KEY = '…'`
is a **VS Code SecretStorage key NAME**, not a credential — proven by its only three usages:
`secrets.get(SECRET_KEY)`, `secrets.store(SECRET_KEY, token)`, `secrets.delete(SECRET_KEY)`. The
token is stored in SecretStorage and never appears in source. Identifier-shaped, dotted,
non-random.

**Zero unresolved production-secret findings.** Two items warrant a human read (`env.ts:32`,
`validate-mail-configs.sh:174`) but neither is a live credential in application code. **No
suppressions or allowlist entries were added** — nothing was changed merely to reduce a count, and
neither scanner was weakened. These pass on canonical PRs today because change sets are small; they
would only surface on a PR touching those files.

### 3.7 ❌ RETRACTED — "2 badge/link references assume `main`"

There are **zero**. The first draft's count came from a loose grep whose `badge.*main` alternative
matched two unrelated UI strings in documentation ("DNS Only" badge, "Enterprise" badge). **No
action required.**

## 4. Cutover sequence (when authorized)

1. Land this readiness branch (workflow triggers + this corrected checklist).
2. Decide §3.3 (`release-check`) and §3.5 (0 approvals).
3. Optionally review the two §3.6 items.
4. Change default branch → `phase-1/canonical-vscode-extension`.
5. Immediately re-verify effective rules still apply (`GET /repos/…/rules/branches/…`).
6. One throwaway PR against the new default; confirm the aggregate reports.
7. Leave `main` and its protection in place; do not rename or delete.
8. Stabilize, then decide: fast-forward `main` · archive `main` · rename canonical (update §3.4 first).

## 5. Rollback

The cutover is a repository *setting*, not a history operation.

| step | rollback |
|---|---|
| Default-branch change | `PATCH /repos/{owner}/{repo}` `{"default_branch":"main"}` — instant, no commits affected |
| Workflow trigger edits | revert the commit; triggers are declarative |
| Ruleset `20017185` | untouched by cutover |
| `main` | never modified; stays at `528be820`, protection intact, ancestor of canonical |

**Recovery invariant:** `main` is an ancestor of canonical and is neither renamed nor deleted, so
every pre-cutover state stays reachable. No step rewrites history.

## 6. Not done

No default-branch change · no rename or deletion of `main` · no protection or ruleset change · no
historical branch deletion · no scanner suppressions.

Post-cutover probe: documentation-only. Throwaway.
