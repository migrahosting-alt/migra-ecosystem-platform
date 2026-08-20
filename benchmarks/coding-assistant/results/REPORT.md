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
| migrapilot | NO-OP (changed nothing) | 5s | 2/3 | 3/4 | 0 | yes | no |
| claude-code | PASS | 51s | 3/3 | 4/4 | 1 | yes | no |
| codex | **COULD NOT RUN** — Codex CLI is older than the account's model; the API refused with HTTP 400 ('gpt-5.6-sol' requires a newer Codex) | — | — | — | — | — | — |
| copilot | **COULD NOT RUN** — GitHub Copilot CLI is blocked by an organisation policy ('Access denied by policy settings') | — | — | — | — | — | — |

MigraPilot capabilities exercised: `coding.issue` `governed-coding` `test.run`

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
| migrapilot | NO-OP (changed nothing) | 4s | 3/3 | 2/2 | 0 | yes | no |
| claude-code | PASS | 46s | 3/3 | 2/2 | 1 | yes | no |
| codex | **COULD NOT RUN** — Codex CLI is older than the account's model; the API refused with HTTP 400 ('gpt-5.6-sol' requires a newer Codex) | — | — | — | — | — | — |
| copilot | **COULD NOT RUN** — GitHub Copilot CLI is blocked by an organisation policy ('Access denied by policy settings') | — | — | — | — | — | — |

MigraPilot capabilities exercised: `coding.issue` `governed-coding` `test.run`

---

## Where the weakness lives

The point of the benchmark is to route each failure to the layer that owns it.

### Brain / retrieval — the biggest gap

**MigraPilot's planner cannot start from a symptom.** On `t2-repair` — *"The test
suite is failing. Find out why, fix the source"* — it refused in 5 seconds:

> `repository_planning refused: no-candidates — The issue text matched no file in this repository. (opened 0 path(s))`

Candidates are ranked by matching the **issue text** against a repository map with
a relevance floor. A prompt that names no file, symbol or identifier ranks nothing
and the run stops. Claude Code solved the same prompt in 51 s by running the suite,
reading the failure, and navigating from there. The capability that is missing is
not intelligence — it is *starting from evidence the tool gathers itself*.

**A single-file change is structurally impossible.** On `t5-refactor`:

> `repository_planning refused: insufficient-evidence — Only 1 file(s) could be retrieved; at least 2 are required to plan a change.`

The refactor is genuinely confined to `pricing.js`. The planner requires two files,
so it refused and edited nothing. This is a hard constraint in the planner, not a
model limitation.

### MigraPilot product / tooling

**Two stacked default timeouts stop real local models.**

1. `BrainClient` reads `migrapilot.brainTimeoutMs`, defaulting to 30 000 ms — and
   that setting **is not declared in `package.json`**, so no user can raise it
   through any documented setting. It governs Explain Selection, Fix Diagnostics,
   Generate Tests and Generate Commit Message. On a 14B local model, Explain fails
   with `request_timeout`.
2. The Brain's own provider timeout defaults to 60 000 ms; the model was *"still
   generating after 58 058 ms"*, so the request became **HTTP 500**.

Stock settings plus the shipped local model equals a product that cannot complete
its own Explain command. Both had to be overridden for this benchmark to measure
anything.

**The engineer stream is not durable enough for slow local inference.** `t4-review`
ran 427 s and ended `Engineer stream interrupted` with no answer.

**The coding loop does not converge.** `t3-feature` is the encouraging result: real
multi-file work across `validation.js`, `orders.js` and `test/orders.test.js`, with
a scope approval carrying a per-file rationale. But it ended `FAILED` at revision
35 with one of its own tests failing — it could not close its own loop.

### Model / intelligence

Genuine but secondary next to the above. The `t1-explain` answer was technically
correct and **written in French** from an English prompt on an English codebase.
`t3-feature` got 4/5 hidden tests: the shape was right, the last case was not.

### Not MigraPilot's fault

`t4-review` was first scored against a **harness bug of mine** — requiring
`dist/services/migraAiClient.js` out of the unzipped VSIX, where its workspace
imports do not resolve. Re-run from the built source tree before scoring.

## What this says about investment order

1. **Retrieval/planning that starts from evidence** — run the suite, read the
   failure, navigate from the stack trace. This single gap cost two of five tasks.
2. **Drop the two-file planning floor.** Single-file changes are ordinary work.
3. **Fix the timeout defaults**, and declare `brainTimeoutMs`.
4. **Make the engineer stream survive minutes of local inference.**
5. Model quality — real, but it is not what lost the tasks.

None of the candidate IDE integrations (right-click Ask, Problems-panel Fix,
clickable `file:line`) would have changed a single result here. They are worth
building later; they are not the bottleneck.
