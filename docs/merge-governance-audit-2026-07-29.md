# Merge governance audit — 2026-07-29

**Scope:** read-only. No repository settings, branch protection, or rulesets were changed.
**Repo:** `migrahosting-alt/migra-ecosystem-platform` (PUBLIC, default branch `main`).
**Method:** `gh api` GET only, against live state on 2026-07-29.

---

## 1. Correction to the previous audit

A prior audit in this workstream reported that *"canonical has no protection of any kind"* and
that branch protection returned `404 Branch not protected`. **That is wrong for `main`.**

`main` is protected, and has been at the time of this audit. The `404` is real, but it belongs
to `phase-1/canonical-vscode-extension` — the integration branch where the work actually lands,
and the base of PRs #120, #121 and #122. The previous audit conflated the two refs and therefore
misattributed the cause of the fast merges.

This matters because the proposed remedy changes: the gap is **not** "main is wide open", it is
**"the integration branch is wide open while main is guarded"** — plus main requiring only half
the available checks.

## 2. Verified current state

| Setting | `main` | `phase-1/canonical-vscode-extension` |
|---|---|---|
| Protected | **yes** | **no** — `404 Branch not protected` |
| Required status checks | **3**: `nginx-gate`, `validate`, `secret-scan` | none |
| Strict (branch up to date) | `true` | — |
| Required approvals | **1** | none |
| Dismiss stale approvals | `true` | — |
| Require code-owner review | `false` | — |
| Require last-push approval | `false` | — |
| Required conversation resolution | `true` | — |
| Enforce for admins | **`true`** | — |
| Force pushes | blocked | **allowed** |
| Branch deletion | blocked | **allowed** |
| Required linear history | `false` | — |
| Required signed commits | `false` | — |
| Lock branch | `false` | — |
| Block creations | `false` | — |

Repository rulesets: **none**. Organization rulesets: not applicable — `migrahosting-alt` is not
an org for ruleset purposes (`GET /orgs/.../rulesets` → 404).

Collaborators (reviewer capacity):

| Account | Role |
|---|---|
| `migrahosting-alt` | admin (PR author on #120–#122) |
| `MigraTeck` | write |

## 3. Why #120, #121 and #122 merged with failing checks

All three targeted the **unprotected** integration branch, not `main`:

| PR | head | base | state |
|---|---|---|---|
| #120 | `extract/console-era/pale-platform` | `phase-1/canonical-vscode-extension` | MERGED |
| #121 | `fix/console-orphan-resolution` | `phase-1/canonical-vscode-extension` | MERGED |
| #122 | `fix/migrateck-platform-ci-gates` | `phase-1/canonical-vscode-extension` | MERGED |

Nothing was bypassed, because on that base nothing was required. `main`'s protection was never
engaged. The integration branch is where every change is first consolidated, so in practice the
guarded ref is the *last* gate rather than the working one.

## 4. Stable check-context names

Captured from PR #122's head commit `96b861c`. All are `check_run`s from the `github-actions`
app; there are no commit *statuses* at all, and no matrix-suffixed variants.

| Context (exact) | Workflow | Job id | Conclusion on `96b861c` |
|---|---|---|---|
| `validate` | `migrateck-platform-ci.yml` | `validate` | **failure** (fixed by this branch) |
| `secret-scan` | `migrateck-platform-ci.yml` | `secret-scan` | success |
| `fresh-clone-proof` | `gap2-repro.yml` | `fresh-clone-proof` | success |
| `guard-bootstrap` | `claude-guards.yml` | `guard-bootstrap` | success |
| `nginx-gate` | `migra-nginx-gate.yml` | `nginx-gate` | success |
| `Workspace Hygiene (Strict)` | `workspace-hygiene-gate.yml` | `workspace-hygiene` | success |

Note the last one: the required context is the job's **`name`**, `Workspace Hygiene (Strict)`,
not its id `workspace-hygiene`. Requiring the id would create a check that never reports.

## 5. Blocking hazard — these contexts are conditional

The previous audit stated there were "no matrix-suffixed or conditional contexts". They are not
matrix-suffixed, but two of the six **are conditional on changed paths**, and one **name is
emitted by two different workflows**. Requiring them naively will wedge PRs.

**5a. `validate` and `secret-scan` are path-filtered.**
`migrateck-platform-ci.yml` runs only for:

```yaml
on:
  pull_request:
    paths: ["MigraTeck/**", ".github/workflows/migrateck-platform-ci.yml"]
```

A PR touching neither path never emits `validate` or `secret-scan`. A required check that is
never reported stays **pending forever** — the PR cannot merge and there is nothing to re-run.
Any PR confined to `Software/`, `apps/pale-platform/`, `docs/`, etc. would be permanently stuck.

**5b. `validate` is a name collision across two workflows.**

| Workflow | Job | Path filter |
|---|---|---|
| `migrateck-platform-ci.yml` | `validate` | `MigraTeck/**` |
| `pale-ci.yml` | `validate` | `Software/Pale/**` |

GitHub matches required checks by context **name**, so both compete for one required slot. A
Pale-only PR satisfies `validate` with the Pale job — a *different* gate than intended — and a
PR touching both areas produces two check-runs sharing one name.

The other four (`fresh-clone-proof`, `guard-bootstrap`, `nginx-gate`,
`Workspace Hygiene (Strict)`) have **no path filter** and always run, so they are safe to
require as-is.

**Recommended fix before requiring anything: an always-reporting aggregate gate.** Add one job
that always runs, depends on the real jobs, and succeeds only if none failed — then require that
single context. Sketch:

```yaml
  ci-gate:
    if: always()
    needs: [validate, secret-scan]
    runs-on: ubuntu-latest
    steps:
      - name: Require no failures
        run: |
          echo '${{ toJSON(needs) }}'
          # skipped => path not touched => acceptable; failure/cancelled => block
          [ -z "$(echo '${{ toJSON(needs) }}' | grep -E '"result": *"(failure|cancelled)"')" ]
```

Rename the `pale-ci.yml` job to `pale-validate` in the same change to end the collision. Both are
workflow edits, **not** settings changes, and are out of scope for this branch — they should land
before protection is applied.

## 6. Proposed protection

Apply to **both** `main` and `phase-1/canonical-vscode-extension`. Values below are the target
state; several already hold on `main` and are listed so the two refs converge.

| Requirement | Target | `main` today | integration today |
|---|---|---|---|
| Required checks | all 6 applicable (via the §5 aggregate where path-filtered) | 3 of 6 | none |
| Strict / up-to-date branch | `true` | already `true` | — |
| Approvals from a non-author | **1** | 1 (but see §7) | none |
| Dismiss stale approvals | `true` | already `true` | — |
| Required conversation resolution | `true` | already `true` | — |
| Force pushes | blocked | already blocked | **allowed** |
| Branch deletion | blocked | already blocked | **allowed** |
| Direct pushes blocked (PR required) | `true` | **not set** — `block_creations: false`, no push restriction | none |
| Enforce for admins | `true` | already `true` | — |
| Emergency bypass | explicit, named, auditable (§8) | none | none |

Deltas that actually need action:

1. **Protect the integration branch at all** — it currently has nothing.
2. **Add the 3 missing checks** to `main`: `fresh-clone-proof`, `guard-bootstrap`,
   `Workspace Hygiene (Strict)`.
3. **Block direct pushes.** Admin enforcement is on, but `main` has no push restriction, so an
   admin can still push a commit directly without a PR. Requiring reviews only constrains PRs;
   it does not force changes through PRs.
4. **Land the §5 workflow fixes first**, or requiring `validate`/`secret-scan` on the integration
   branch will wedge every non-`MigraTeck/**` PR.

**Sequencing.** `validate` only became passable with this branch's commit. Requiring it before
this lands would block every PR including its own fix. Order: land this PR → apply §5 workflow
fixes → apply protection to both refs.

## 7. Reviewer policy — the self-approval problem

GitHub does not let an author approve their own PR. With `migrahosting-alt` authoring nearly all
work, a 1-approval requirement is unsatisfiable without a second reviewer. The approval
requirement should **not** be weakened to accommodate this. Options, best first:

1. **Add a human reviewer** with `write` (a contractor, collaborator, or second engineer).
   The only option that produces genuine second-party review. Preferred.
2. **Designate `MigraTeck` as the engineering reviewer account.** It already holds `write`, so
   this needs no new access. It satisfies the mechanism and creates an auditable approval trail,
   but a second account under the same operator is *procedural*, not independent review — it
   should be an interim step, documented as such, not the permanent answer.
3. **CODEOWNERS with `require_code_owner_reviews`** — only meaningful once (1) exists; with a
   single operator it reduces to (2).
4. **Emergency bypass as the routine path — rejected.** If bypass becomes normal, protection is
   theatre. See §8.

Recommendation: adopt (2) now so the integration branch can be protected immediately, and treat
(1) as the standing goal. Do not lower the approval count to zero.

## 8. Emergency bypass

Admin enforcement with no escape hatch means an unavailable required workflow — a GitHub Actions
outage, a runner image change, a deleted workflow file — blocks all merges with no legitimate
route. Pair enforcement with a bypass that is explicit and auditable:

- **Mechanism:** a repository **ruleset** (not classic protection) targeting each ref, with a
  named entry in `bypass_actors`. Ruleset bypasses are recorded in the ruleset's history; classic
  protection has no comparable audit trail. This is a reason to migrate to rulesets.
- **Actor:** one named account or a dedicated `break-glass` GitHub App — never "all admins", and
  never the routine author account.
- **Conditions:** permitted only when a *required workflow cannot report* (infrastructure
  failure), never to skip a failing check.
- **Obligation:** every use opens a follow-up issue within 24h recording who, what, why, and the
  remediation. Review bypass history at each release.
- **Anti-goal:** bypass must not become the normal merge path. If it is used more than once per
  quarter, the gate is misconfigured — fix the gate, not the exception.

## 9. Actions taken

None. This audit is read-only:

- no branch protection created, modified, or deleted;
- no rulesets created or modified;
- no repository settings changed;
- no reviewer or collaborator changes;
- no workflow files modified by this audit (the §5 fixes are proposals).

Recorded for the record: the only write actions in this workstream were a push of
`fix/migrateck-ci-environment-parity` and opening a **draft** PR, both explicitly authorised.

---

## 10. Incident record — PR #124, same-actor promote-and-merge (2026-07-30)

Appended as a follow-up. This section records an observed event; §9 above remains accurate for the
original audit.

### What GitHub records

From the PR #124 timeline and merge metadata, quoted as the API reports them:

```
2026-07-30T03:46:06Z  ready_for_review   actor: migrahosting-alt
2026-07-30T03:46:10Z  merged             actor: migrahosting-alt
2026-07-30T03:46:10Z  closed             actor: migrahosting-alt
```

| field | value |
|---|---|
| ready for review | `2026-07-30T03:46:06Z` |
| merged | `2026-07-30T03:46:10Z` |
| interval | **4 seconds** |
| actor attribution | `migrahosting-alt` on all three events, exactly as reported by GitHub |
| merge commit | `598743e1a0ea965f3f0408e3e0de8d6a7adc7e7d` |
| head at merge | `1c53092129cafdcbe111545329ca3ba46bb458f9` |
| base branch | `phase-1/canonical-vscode-extension` |
| base protection at the time | **none** — `GET /branches/.../protection` returned `404 Branch not protected`; no rulesets existed |

### What this is, and what it is not

The PR had been asked to remain a draft pending a governance review. It was promoted and merged four
seconds later.

**All five visible checks were green at merge** — `canonical-integration-gate`, `nginx-gate`,
`Workspace Hygiene (Strict)`, `guard-bootstrap` and `fresh-clone-proof` all reported `SUCCESS`, with
zero pending, cancelled or failed. The merged head was the expected commit and the base was the
expected branch.

So this was **not a code-quality failure.** The merged content was exactly what had been reviewed and
validated. The failure was **process enforcement**: nothing in the repository required the review
step to happen, because the base branch had no protection and no required checks. A four-second
promote-and-merge was permitted by configuration, not achieved in spite of it.

**No inference is drawn about whether the action was human or automated.** GitHub attributes an
event to the account whose credentials performed it; the API does not distinguish a person acting
interactively from automation using the same account's token. The attribution above is recorded as
reported and nothing further is claimed.

### Why it is recorded here

This is the concrete case for protecting the integration branch, and it is the second instance of
the pattern:

| PR | ready → merged | interval | base protection |
|---|---|---|---|
| #123 | `02:22:01Z` → `02:22:05Z` | 4s | none |
| #124 | `03:46:06Z` → `03:46:10Z` | 4s | none |

PRs #120, #121 and #122 show the same shape earlier — ready to merged in roughly four to six
seconds, same base, and in those cases with checks that were failing or absent rather than green.

The operational consequence is already visible: an exact-version `sharp` pin intended for #123 was
still in flight when #123 merged, so it was stranded on a dead branch and had to be re-landed
separately as PR #125. Treat any pushed PR on this base as mergeable without warning, and make each
branch complete before its first push.

### The control that addresses it

`require_last_push_approval: true` in the proposed integration ruleset (§6) is the specific rule
that closes this path: the account that made the most recent push cannot supply the required
approval. Combined with one required approving review, review-thread resolution and stale-review
dismissal, promote-and-merge by a single actor is refused rather than merely discouraged.

Status at time of writing: ruleset `canonical-integration-branch` (id `20017185`) exists with those
rules but `enforcement: "disabled"`, so it is inert. `evaluate` mode is unavailable — this
repository's plan rejects it with *"Enforcement evaluate option is not supported on this plan"* — so
the intended observe-before-enforce step cannot be performed as designed. No bypass actors are
configured.
