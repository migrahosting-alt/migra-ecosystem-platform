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

---

## Slice 2 — frozen five-task evidence

Two complete runs on the identical build, fixed harness, **shipped defaults, no timeout
overrides**. Both are shown wherever they differ: one number per task would hide how
unstable some of this is, and the instability is itself the finding.

| Task | Frozen run (with provenance) | Early read | Same outcome? |
|---|---|---|---|
| `t1-explain` | 9s · **empty answer (67 bytes)** | 63s · real answer, **in French** | **NO — content** |
| `t2-repair` | 59s · visible 3/3 · hidden 4/4 · 1 file(s) | 55s · visible 3/3 · hidden 4/4 · 1 file(s) | yes |
| `t3-feature` | 306s · visible 0/5 · hidden 0/5 · 3 file(s) | 321s · visible 4/5 · hidden 4/5 · 3 file(s) | **NO** |
| `t4-review` | 134s · **found the real defect** | 193s · **analysis inverted** | **NO — content** |
| `t5-refactor` | 117s · visible 3/3 · hidden 2/2 · 1 file(s) | 125s · visible 3/3 · hidden 2/2 · 1 file(s) | yes |

### Provenance — every task got its own Brain

| Task | Brain PID | Port | Uptime at attach | Overrides | Workspace root |
|---|---|---|---|---|---|
| `t1-explain` | 2546258 | 43320 | 0s | `[]` | `…-t1-explain-tqYUgd` |
| `t2-repair` | 2547964 | 44940 | 0s | `[]` | `…h-t2-repair-6bsxFO` |
| `t3-feature` | 2552965 | 43822 | 0s | `[]` | `…-t3-feature-5mfPbd` |
| `t4-review` | 2575549 | 44794 | 0s | `[]` | `…h-t4-review-BJlIld` |
| `t5-refactor` | 2586353 | 43690 | 0s | `[]` | `…t5-refactor-ztcKEP` |

The pass/fail columns say **nothing** about whether an explanation or a review was
correct — `t1` and `t4` produce no tests to run. Both were read by hand, and both
differed completely between runs while scoring identically. A column that had only
counted tests would have called them stable; it was corrected rather than kept.

### Answer quality, read by hand

- **`t1-explain`** — frozen run returned an **empty document**: a title, the
  provenance line, and an unterminated code fence. 67 bytes, no error, presented as
  a finished answer. The early read returned a correct explanation **written in
  French** from an English prompt on an English codebase.
- **`t4-review`** — frozen run **identified the real defect**: *"reservations are
  decremented even if an OutOfStockError is thrown for one of the lines… leading to
  an inconsistent inventory state."* The early read asserted the exact opposite —
  that the single pass *ensures* atomicity — and invented a race condition
  irrelevant to single-threaded JavaScript. Both correctly made no edits.
- **`t3-feature`** — frozen run changed +70/−41 across three files and broke **every
  pre-existing test**, including three that passed at baseline. The early read got
  4 of 5 hidden checks. Same build, same prompt, same fixture.

## Failure ownership — one owner each

| Task | Outcome | Primary owner |
|---|---|---|
| `t1-explain` | empty answer (frozen) / French answer (early) | **model/intelligence** |
| `t2-repair` | **PASS** in both runs | — |
| `t3-feature` | fails, and unstable between 0/5 and 4/5 | **model/intelligence** |
| `t4-review` | completes; correct once, inverted once | **model/intelligence** |
| `t5-refactor` | **PASS** in both runs | — |

**Nothing remains in retrieval/planning, transport/runtime, or benchmark/harness.**
Slice 1 removed the planning refusals; Slice 2 removed the deadline and stream
failures; the harness now proves per-task isolation. Every surviving defect is in
the model layer.

Two **workflow/tooling** contributors are worth separating out, because they are
MigraPilot's to fix even though the model caused the underlying error:

1. **An empty completion is presented as a successful answer.** Same family as the
   stream-interruption fix — never present nothing as an answer.
2. **The coding loop can terminate leaving its own declared verification failing
   outright.** On `t3` it ran `test.run`, observed a suite where nothing passed, and
   finished anyway with the workspace worse than it started. A bounded
   repair-or-revert loop is the missing piece.

## Acceptance

| Criterion | Result |
|---|---|
| `t2` and `t5` PASS from clean baselines | ✅ both, in both runs |
| `t1` completes without timeout or connection loss | ✅ both runs |
| `t3` fails for a real reasoning/self-repair reason, not transport | ✅ no transport failure in either run's Brain log |
| `t4` completes with a truthful terminal state attributable to reasoning | ✅ both runs |
| Every task on its own Brain, own ephemeral port | ✅ five distinct PIDs and ports |
| No result from a Brain the harness did not start | ✅ `uptimeSecAtAttach: 0` on all five |
| No timeout overrides in the launcher | ✅ `timeoutOverrides: []` on all five |

## Known limitation of this evidence

`provenance.modelRequested` records `qwen3-coder:30b`, which is what the launcher
configured — **not necessarily what the router selected**. The router has been
observed choosing `qwen2.5-coder:14b` at the `balanced` tier for the same request.
The field was renamed from `model` after this run, and a `modelRouted` slot is now
populated from the engine's own `route` frame; these five records predate that, so
their model field states an intention, not a fact.

---

## Slice 3 — workflow truthfulness (t1 and t3 rerun)

Two fixes, both about a run claiming more than it achieved. No retrieval, planning,
model, prompt or UI change.

**An empty completion is no longer a success.** New terminal state
`empty_completion`, and the extension refuses to open a document that contains no
answer. The substance check is deliberately crude and generous — it separates *an
answer* from *punctuation* and explicitly does not judge quality, because a wrong
answer is still an answer. A test asserts against the exact 67-byte string the
frozen run produced.

**The repair loop can now tell it is going backwards.** Bounded three ways rather
than one:

| Guard | Stops when |
|---|---|
| ceiling (3 → **2**) | a backstop, no longer the primary bound |
| `regressed-beyond-baseline` | a test that passed **before the run started** now fails |
| `repair-made-no-progress` | a landed repair produced the **identical** failure |

Only attempts that actually **landed** count as progress evidence: a rejected
proposal leaves the tree untouched, so the next validation is identical by
construction. Reading that as a stall killed a loop that went on to succeed — the
existing suite caught it.

### t3, before and after

| | wall | visible | hidden | diff | stop reason |
|---|---|---|---|---|---|
| before | 306s | 0/5 | 0/5 | +70/−41 | `repair-ceiling-exhausted` |
| after | 229s | 3/4 | 4/5 | **+25/−0** | **`regressed-beyond-baseline`** |

The guard fired, named the cause, and spent **zero** repair attempts after
detecting harm — revision 16 against 31–39 before. **The smaller damage is not
attributable to the guard**: a better initial apply is within this model's measured
variance. What the guard demonstrably changed is that the run stopped instead of
spending its budget, and said why.

### t1, before and after

| | wall | answer |
|---|---|---|
| frozen run | 9s | **67 bytes** — title, stamp, unterminated fence, reported as an answer |
| after | 135s | 3 667 bytes, substantive, in English |

**The empty-completion guard did not fire in this run** — the model produced a real
answer, so there was nothing to suppress. It is proven by unit test against the
recorded 67-byte output, not by live reproduction; the empty case is intermittent.
t1 has now produced a French answer, an empty answer and an English answer across
three runs of the same build.

### Two defects found in my own fix

Recorded because both would have shipped silently:

1. **The guards were wired into `codingRun.ts`, which has no production callers.**
   Twelve tests passed against code the product never executes, and the first t3
   rerun returned `repair-ceiling-exhausted` unchanged. Caught by reading the stop
   reason rather than the pass/fail line.
2. **The baseline was measured after the first write**, so the guard compared the
   model's changes against themselves and could never have detected harm. It now
   runs on the untouched tree, before the initial apply.
