# Default-branch cutover checklist — `main` → `phase-1/canonical-vscode-extension`

**Status: NOT EXECUTED.** No default-branch change, rename, protection change, or historical branch
deletion has been performed. This document is the pre-flight record and the rollback procedure.

Prepared 2026-07-30, against canonical `b68eadc`.

---

## 1. Verified preconditions

| # | Condition | Evidence | State |
|---|---|---|---|
| 1.1 | Reconciled canonical contains **both** histories | `6ec2e7e` (previous canonical tip) and `528be820` (main tip) are both ancestors of `b68eadc` | ✅ |
| 1.2 | `main` is an ancestor of canonical | `git merge-base --is-ancestor origin/main canonical` → true. A later fast-forward of `main` remains possible | ✅ |
| 1.3 | Reconciliation merged deliberately | PR **#132** MERGED 2026-07-30T21:57:33Z, merge commit `b68eadc`, head at merge `2aa411d`, base `phase-1/canonical-vscode-extension` | ✅ |
| 1.4 | `universal-required-gates.yml` targets both branches | `pull_request.branches: [main, phase-1/canonical-vscode-extension]` | ✅ |
| 1.5 | No duplicate check-context names | Every job name emitted on canonical is unique; `validate`/`secret-scan` are emitted **only** by the universal gate, canonical platform CI renamed to `canonical-platform-validate` / `canonical-platform-secret-scan` | ✅ |
| 1.6 | Ruleset `20017185` active | `enforcement: active`, 0 bypass actors, sole required context `canonical-integration-gate` | ✅ |
| 1.7 | Direct push / force-push / deletion blocked | Proven by live attempts: `GH013 … Changes must be made through a pull request`; force-push and deletion refused on a disposable mirror under an equivalent ruleset | ✅ |
| 1.8 | Documentation-only PR is safe | Probe PR #133 — see §2 | ✅ |
| 1.9 | Unrelated-path PR is safe | Probe PR #134 — see §2 | ✅ |
| 1.10 | PR #91 content already represented | Its 689 removals target `MigraTeck/C:\Users\…\lighthouse.*`, **not tracked** on canonical (no-op); its `.gitignore` rule is redundant (canonical already carries 5 lighthouse rules) | ✅ |
| 1.11 | PR #93 superseded | Its head `6ec2e7e` is an ancestor of canonical — every commit retained | ✅ |
| 1.12 | Rollback documented | §5 | ✅ |

## 2. Probe context matrix

Both probes ran against the **post-reconciliation** gate table (their merge refs picked up `b68eadc`).

| context | docs-only (#133) | unrelated-path (#134) |
|---|---|---|
| `guard-bootstrap` | applicable → success | applicable → success |
| `fresh-clone-proof` | applicable → success | applicable → success |
| `nginx-gate` | applicable → success | applicable → success |
| `Workspace Hygiene (Strict)` | applicable → success | applicable → success |
| `validate` | applicable → success | applicable → success |
| `secret-scan` | applicable → success | applicable → success |
| `canonical-platform-validate` | **not applicable** | **not applicable** |
| `canonical-platform-secret-scan` | **not applicable** | **not applicable** |
| `extension` | **not applicable** | **not applicable** |
| `pale-validate`, `pale-backend-checks`, `pale-mobile-checks`, `pilot-ci` | **dormant** | **dormant** |
| **`canonical-integration-gate`** | **SUCCESS** | **SUCCESS** |

6 applicable / 3 not applicable / 4 dormant in both cases. **No context was left indefinitely
expected.** Neither probe was merged; both closed, both branches deleted.

## 3. ⚠️ Open items that must be decided BEFORE cutover

### 3.1 Push-triggered workflows are bound to `main` — deploys would silently stop

These fire on `push` to `main` only. After cutover, merges land on canonical and **these never run
again** until their triggers are updated:

| workflow | consequence if not updated |
|---|---|
| `pale-staging-deploy.yml` | **Pale staging deploys stop firing** |
| `pale-staging-backend.yml` | **Pale staging backend CI stops firing** |
| `migrateck-platform-ci.yml` (push job) | post-merge platform validation stops |
| `workspace-hygiene-gate.yml` (push) | post-merge hygiene stops |
| `migrapilot-enterprise-gate.yml` | post-merge enterprise gate stops |
| `migrapilot-pilot-web-gate.yml` | already dormant/broken — no change |

`migrapilot-extension.yml` uses `push: [main, phase-*/**]` and **already covers** canonical.

**This is the highest-impact cutover item.** It is a silent failure: nothing errors, the deploys
simply stop.

### 3.2 `release-check` is PR-triggered on `main` only

`release-check.yml` has `pull_request.branches: [main]`. After cutover it will not run on canonical
PRs at all. It is currently **failing and has never passed**, so requiring it is not viable either
way — but its absence should be a decision, not an accident.

### 3.3 Everything protective keys off literal branch names

| item | binding |
|---|---|
| ruleset `20017185` | `refs/heads/phase-1/canonical-vscode-extension` |
| `canonical-integration-gate.yml` | `pull_request.branches: [phase-1/canonical-vscode-extension]` |
| `universal-required-gates.yml` | `[main, phase-1/canonical-vscode-extension]` |

Cutover alone is safe — the ref name does not change. **A later rename of canonical to `main` drops
protection and gating unless these three are updated first.** Keep the universal gate's two-branch
list until after both cutover *and* any rename.

### 3.4 The default branch will require 0 approvals

Canonical's ruleset requires `required_approving_review_count: 0` (deliberate interim: no
independent reviewer exists). `main` nominally requires 1. Cutover therefore moves the default to a
branch with a *lower nominal* approval bar. Substantively nothing is lost — main's 1 was satisfiable
only by an account under the same operator — but it should be an explicit acceptance.

### 3.5 Canonical's tree contains ~14 paths main's scanner flags

Evaluated with `main` as base (PR #93's context), `secret_scan.py` reported findings in
`apps/brain-service/test/redaction.test.ts`, `apps/pilot-web/scripts/pilot/verify-redaction.ts`,
`apps/pilot-web/migrations/README.md`, `infra/enterprise/mail/MAIL_SERVER_RUNBOOK.md`,
`apps/vscode-extension/src/services/pilotConfigVscode.ts` and others.

These are overwhelmingly **security test fixtures and redaction verifiers** — files that must
contain secret-shaped strings to test that secrets get redacted. They do **not** fail on canonical
PRs today because the change set is small. But after cutover, **any PR touching one of those files
will fail `secret-scan`**. Triage them and add narrow suppressions
(`secret-scan:allow(<rule-id>)` inline, or exact-path entries in
`.github/secret-scan-allowlist.json`) before they become landmines. `pilotConfigVscode.ts`
(`generic-api-secret`) should be read by a human rather than assumed benign.

### 3.6 Badges / links

2 references to `main` in `README.md` / `docs/`. Cosmetic; update after cutover.

## 4. Cutover sequence (when authorized)

1. Update the `push:` triggers in §3.1 to include `phase-1/canonical-vscode-extension` — **land this
   first**, or deploys stop.
2. Triage §3.5 findings and add narrow suppressions.
3. Decide §3.2 (`release-check`) and §3.4 (0 approvals).
4. Change default branch: `main` → `phase-1/canonical-vscode-extension`.
5. Immediately re-verify effective rules still apply to canonical (`GET /repos/…/rules/branches/…`).
6. Open one throwaway PR against the new default; confirm `canonical-integration-gate` still reports.
7. Leave `main`'s classic protection **in place**; do not rename or delete `main`.
8. Stabilization window. Only then decide: fast-forward `main` to canonical · archive `main` ·
   rename canonical to `main` (and if renaming, update §3.3 first).

## 5. Rollback

The cutover is a repository *setting*, not a history operation, so rollback is immediate and lossless.

| step | rollback |
|---|---|
| Default-branch change | `PATCH /repos/{owner}/{repo}` with `{"default_branch":"main"}`. Instant. No commits affected. |
| Workflow trigger edits (§3.1) | Revert the commit; triggers are declarative. |
| Secret-scan suppressions (§3.5) | Revert the commit. |
| Ruleset `20017185` | Untouched by cutover. If it must be removed: `DELETE /repos/…/rulesets/20017185`. Canonical reverts to unprotected — do this only deliberately. |
| `main` branch | Never modified. `528be820` remains its tip, protection intact, and it is an ancestor of canonical, so nothing is orphaned. |

**Recovery invariant:** because `main` is an ancestor of canonical and is neither renamed nor
deleted, every pre-cutover state is reachable at all times. No step in §4 rewrites history.

## 6. Not done

No default-branch change · no rename or deletion of `main` · no protection or ruleset change · no
historical branch deletion. PRs #91 and #93 are closed (superseded) with their source branches
deliberately retained.
