# MigraPilot capability benchmark — results

Same repository state, same prompt, hidden verification the tool never saw.


## t1-explain — Explain a non-trivial code path

| Tool | Verdict | Time | Visible | Hidden | Files | Ran tests | Touched tests |
|---|---|---|---|---|---|---|---|
| migrapilot | n/a | 74s | 3/3 | n/a | 0 | no | no |
| claude-code | n/a | 59s | 3/3 | n/a | 0 | no | no |
| codex | **COULD NOT RUN** — Codex CLI is older than the account's model; the API refused with HTTP 400 ('gpt-5.6-sol' requires a newer Codex) | — | — | — | — | — | — |
| copilot | **COULD NOT RUN** — GitHub Copilot CLI is blocked by an organisation policy ('Access denied by policy settings') | — | — | — | — | — | — |

Answer quality — read by a human (Claude (this session), from the saved transcripts in this directory):

- **migrapilot** — correct: Technically accurate: names validation.js, pricing.js, repository, and gets the four pricing steps in the right order (subtotal -> member -> coupon -> tax). ANSWERED IN FRENCH despite an English prompt on an English codebase. Did not mention that stock is released when pricing throws.
- **claude-code** — correct: Complete and precise, with file:line citations (src/orders.js:18, src/validation.js:11). Covers the release-on-throw path the task asked about.

MigraPilot capabilities exercised: `editor-selection` `explain-selection`

## t2-repair — Diagnose and repair a failing test

| Tool | Verdict | Time | Visible | Hidden | Files | Ran tests | Touched tests |
|---|---|---|---|---|---|---|---|
| migrapilot | PASS | 122s | 3/3 | 4/4 | 1 | yes | no |
| claude-code | PASS | 51s | 3/3 | 4/4 | 1 | yes | no |
| codex | **COULD NOT RUN** — Codex CLI is older than the account's model; the API refused with HTTP 400 ('gpt-5.6-sol' requires a newer Codex) | — | — | — | — | — | — |
| copilot | **COULD NOT RUN** — GitHub Copilot CLI is blocked by an organisation policy ('Access denied by policy settings') | — | — | — | — | — | — |

MigraPilot capabilities exercised: `coding.issue` `coding.scope-approval` `governed-coding` `test.run`

## t3-feature — Implement a small feature across multiple files

| Tool | Verdict | Time | Visible | Hidden | Files | Ran tests | Touched tests |
|---|---|---|---|---|---|---|---|
| migrapilot | FAIL (hidden 4/5) | 330s | 5/6 | 4/5 | 3 | yes | yes |
| claude-code | PASS | 115s | 7/7 | 5/5 | 2 | yes | yes |
| codex | **COULD NOT RUN** — Codex CLI is older than the account's model; the API refused with HTTP 400 ('gpt-5.6-sol' requires a newer Codex) | — | — | — | — | — | — |
| copilot | **COULD NOT RUN** — GitHub Copilot CLI is blocked by an organisation policy ('Access denied by policy settings') | — | — | — | — | — | — |

MigraPilot capabilities exercised: `coding.issue` `coding.scope-approval` `governed-coding` `test.run`

## t4-review — Review a dirty diff and identify a real defect

| Tool | Verdict | Time | Visible | Hidden | Files | Ran tests | Touched tests |
|---|---|---|---|---|---|---|---|
| migrapilot | ERROR | 427s | 3/3 | n/a | 1 | no | no |
| claude-code | ok (no edits) | 21s | 3/3 | n/a | 1 | no | no |
| codex | **COULD NOT RUN** — Codex CLI is older than the account's model; the API refused with HTTP 400 ('gpt-5.6-sol' requires a newer Codex) | — | — | — | — | — | — |
| copilot | **COULD NOT RUN** — GitHub Copilot CLI is blocked by an organisation policy ('Access denied by policy settings') | — | — | — | — | — | — |

Answer quality — read by a human (Claude (this session), from the saved transcripts in this directory):

- **migrapilot** — not correct: No answer produced. git.overview succeeded, then the engineer stream ran 427s and was interrupted. Workflow/robustness failure, not a wrong answer.
- **claude-code** — correct: Identified the exact defect: the single-pass rewrite breaks the atomicity the docstring promises. Gave a concrete triggering input and traced the consequence (stock decremented, no reservation recorded, release() cannot recover it). Made no edits, as instructed.

MigraPilot capabilities exercised: `git.overview`

## t5-refactor — Refactor while preserving behaviour

| Tool | Verdict | Time | Visible | Hidden | Files | Ran tests | Touched tests |
|---|---|---|---|---|---|---|---|
| migrapilot | PASS | 76s | 3/3 | 2/2 | 1 | yes | no |
| claude-code | PASS | 46s | 3/3 | 2/2 | 1 | yes | no |
| codex | **COULD NOT RUN** — Codex CLI is older than the account's model; the API refused with HTTP 400 ('gpt-5.6-sol' requires a newer Codex) | — | — | — | — | — | — |
| copilot | **COULD NOT RUN** — GitHub Copilot CLI is blocked by an organisation policy ('Access denied by policy settings') | — | — | — | — | — | — |

MigraPilot capabilities exercised: `coding.issue` `coding.scope-approval` `governed-coding` `test.run`

---

## Remediation slice 1 — planning/retrieval (re-run of tasks 2 and 5)

Two changes, both in the Brain's planning layer. No model, prompt, IDE or
integration change.

**Planning can start from a symptom.** When the issue text ranks nothing, the
planner asks the driver to run the *declared* verification and reads what broke:
paths the failure names directly (stack frames, `FAIL` headlines, TAP subtest
headers) become candidates, and the failing test names and assertion bodies become
the ranking query. The driver owns the command, so it is the same declared
validation, the same governed runner, the same containment — the planner decides
only *when* evidence is needed.

**One readable file is sufficient evidence.** `minEvidenceFiles` was 2, which made
a legitimate single-file change impossible. The rule that matters is that the
planner read something real; a file *count* is a bad proxy for it, and the only way
to satisfy it is to open files the change does not concern.

| Task | Before | After |
|---|---|---|
| `t2-repair` | `no-candidates` in 5s, 0 files | **PASS** — 122s, `src/orders.js` +1/−1, visible 3/3, hidden 4/4 |
| `t5-refactor` | `insufficient-evidence`, NO-OP | **PASS** — 76s, `src/pricing.js` +13/−2, visible 3/3, behaviour oracle 2/2 |

It found the right file from the symptom alone. Its own scope rationale for `t2`:

> *"The tax calculation in submitOrder was incorrect, using subtotal instead of the
> discounted amount which caused test failures."*

That is the actual bug, stated correctly, from a prompt that named no file.

Acceptance, point by point:

- `no-candidates` no longer returned for the failing-test task — **yes**;
- evidence is run and read, and the relevant file identified — **yes**, `src/orders.js`;
- the single-file refactor is no longer refused — **yes**, `src/pricing.js`;
- unrelated files are not added to satisfy planning — **yes**, one file each, and
  a test asserts the scope is not padded;
- containment and governance intact — **yes**: the probe runs the declared command
  through the same governed runner, every candidate still passes through the
  evidence ledger, and a test forges `/etc/passwd.js` and `../../outside/secret.js`
  into the failure output and asserts neither can be opened;
- tests untouched in both runs — **yes**.

12 new tests in `brain-service/test/symptomDrivenPlanning.test.ts`; the brain suite
is 1393/1505 with the same 57 pre-existing Postgres failures as before the change.

Still open, for the next slices: `t1` answered in French, `t3` did not converge
(4/5 hidden, ended FAILED at revision 35), `t4` interrupted after 427s.
