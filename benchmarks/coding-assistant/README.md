# Coding-assistant capability benchmark

Measures what MigraPilot can actually do on real coding tasks, against the tools it
has to beat. Same starting repository, same prompt, hidden verification.

## Protocol

Every `(tool, task)` pair gets a **fresh clone of the pristine fixture** with the
task's setup applied and committed, so no run can see another's work. The tool is
given the prompt and full freedom to edit and run commands. Afterwards the harness
measures, from outside:

| Recorded | How |
|---|---|
| patch correctness | **hidden** suites in `verify/`, copied in after the run, never present while the tool works |
| unrelated changes | `git status` scope — files, insertions, deletions |
| verification chosen | whether the tool ran the suite itself, from its own transcript |
| completion time | wall clock around the tool invocation |
| tests tampered with | whether `test/` was touched |
| capabilities exercised | MigraPilot only — which internal lanes actually fired |

Judgement — plan quality, explanation quality — is **not** invented by the harness.
An earlier keyword rubric scored a flawless review 0/3, so it was deleted rather
than dressed up. Reads live in `results/judgement.json`, attributed to whoever
made them, and the transcripts are kept so anyone can disagree.

A tool that could not START is marked `COULD NOT RUN` with the reason and is never
scored. A tool that changed nothing is `NO-OP`, never `PASS` — the refactor oracle
pins behaviour, so doing nothing satisfies it trivially.

## The tasks

| id | what it measures |
|---|---|
| `t1-explain` | reading a non-trivial path and stating precedence correctly |
| `t2-repair` | starting from a symptom ("the suite is failing") with no file named |
| `t3-feature` | a small feature across validation + orders, with its own tests |
| `t4-review` | finding a real defect in an uncommitted diff that the visible tests do not catch |
| `t5-refactor` | a single-file, behaviour-preserving change |

The review defect is deliberately invisible to the visible suite: a "single pass"
rewrite of `Inventory.reserve` that breaks the atomicity its own docstring
promises. The repair bug contradicts the documented pricing rule in the same file.

## Running it

```bash
node bench.mjs claude-code            # or codex | copilot
DISPLAY=:99 node adapters/migrapilot-launch.mjs   # real VS Code + packaged VSIX
node report.mjs                       # writes results/REPORT.md
```

MigraPilot runs through the **installed product surface**: a real VS Code loading
the packaged VSIX, driving the registered commands (`explainSelection`,
`governedCoding`, `runTests`, `git.overview`) with a scripted human supplying only
the task text and one scope approval.

## A launcher must own the service it measures

This harness once pinned a fixed Brain port and killed the process between tasks.
When one survived, the next Brain logged *"port already in use; reusing the
existing healthy local service"* **and exited** — so the launcher's kill hit a
dead PID, and every later task silently talked to a Brain whose allowed workspace
root was the **previous task's**. Three tasks scored zero files with
`workspaceRoot is outside the allowed workspace boundary`. It looked exactly like
a product regression across two completed slices. It was not.

Three defences, all now in `adapters/migrapilot-launch.mjs`:

1. **A free ephemeral port per task** — never a fixed one.
2. **Fail fast**: a spawned Brain that exits before becoming healthy is an error,
   not something to keep polling for two minutes.
3. **Provenance on every record** — PID, port, workspace root, service identity
   and uptime-at-attach. A Brain this harness started has near-zero uptime, so an
   attach to a long-running one is refused outright. These fields travel with the
   result so a future run cannot quietly become incomparable to this one.

**Never trust a cross-task regression before checking that every task got its own
backend.**

A fourth defence, added after a rerun destroyed the evidence it was being compared
against: **every run is archived** under `results/runs/<task>/<brainPid>.*`, so
`results/migrapilot__<task>.*` being the latest never costs the previous one. A
comparison whose baseline can be overwritten by the act of measuring is not a
comparison.

## Environment caveats, recorded not hidden

- MigraPilot's local model was `qwen2.5-coder:14b` (the router's choice at the
  `balanced` tier; `qwen3-coder:30b` is installed but spills a 12 GB card).
- Timeout overrides were REMOVED after remediation slice 2. The benchmark now
  runs on the shipped defaults, so it measures what a user actually gets; a
  deadline failure from here on is a real result. `provenance.timeoutOverrides`
  records this per task.
