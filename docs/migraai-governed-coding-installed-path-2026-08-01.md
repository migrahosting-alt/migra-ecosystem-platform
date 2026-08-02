# MigraAI Governed Coding — Installed-Path Evidence (Packaged VSIX)

**Date:** 2026-08-01 · **Provider:** scripted · **Production touched:** none

> **The provider is SCRIPTED.** This proves integration determinism through the
> installed artifact — that the layers are genuinely connected and the governance
> rules hold end to end. It proves **nothing** about real-model competence. That is
> separate capability evidence and is still outstanding.

## Artifact identity

| Item | Value |
|---|---|
| Package | `migrapilot-extension-e2e.vsix`, 563,136 bytes |
| VSIX sha256 (first 32) | `c56f3a75cacd2b10ccb0ed7c12904523` |
| Extension version | `0.1.0` |
| Brain build | branch `feat/governed-coding-extension-surface`, base commit `29317be` |
| Extension under test | the **unpacked VSIX payload**, not the source tree |
| Durable store | real SQLite, temporary path outside the workspace (path not recorded) |
| Journal schema | v7 (`agent_run_children`, domain payload) |
| Fixture | real git repository, committed clean before acceptance |
| Validation command | `node --test --test-reporter=tap test/orderTotals.test.js`, from configuration |

## Fixture baseline — verified before activation

```
coding fixture baseline: exit 1, 0 pass, 5 fail
```

The harness aborts if this is not exactly five genuine failures; measuring a
damaged fixture would produce an acceptance result about the wrong repository.

## Path exercised

```
VS Code command registry → real command handler → workspace resolution
  → extension workflow orchestration → Brain HTTP API → durable SQLite journal
  → approval interaction → repository mutation → validation and repair
  → rendered final report
```

Only the human's answers were scripted, through the injected `GovernedCodingUi`.
The acceptance never calls the coding client directly.

## Scenario results — 10/10

```
✔ 1  — the command is contributed by the packaged artifact
✔ 1b — capability unavailability is presented accurately, not as a missing run
✔ 2+3 — the active workspace is resolved; a multi-root workspace is refused
✔ 4–13 — one approval drives plan → wrong edit → repair → validated report
✔ 7+10 — rejection leaves the repository unchanged
✔ 9  — a scope decision carrying a stale revision is refused by the Brain
✔ 14 — cancellation requested is never rendered as confirmed cancellation
✔ 15 — reload recovers the run from Brain state, not local inference
✔ no mutation occurred outside the configured workspace root
✔ no raw model response or secret is rendered to the user
```

Suite total: **104 passing, 0 failing** (40s).

## What the operator was shown, and what happened

| Item | Observed |
|---|---|
| Proposed scope | exactly the three required files |
| Trap file | excluded by reasoning, never proposed, never written |
| Per-file rationale | present for all three |
| Evidence line ranges | present for all three |
| Scope hash / expiry | present in document and modal |
| Mutation before approval | **none** — `git status` empty at the approval boundary |
| Approval | one, bound to the displayed revision and hash |
| Initial edit | deliberately wrong (`cancelledCount`) |
| Initial validation | genuinely failed |
| Repair | cited failure-evidence IDs the run itself generated |
| Final validation | passed |
| Files changed | exactly the three approved files, matching `git status` |
| Fixture re-run | 5 pass, 0 fail |
| Rejection run | zero writes, `REJECTED`, no mutation child registered |

## Two production defects this gate found

Both were invisible to unit and route tests, and both shipped before this run.

**1 — Child ids were not namespaced by run.** `child_id` is a global PRIMARY KEY,
and the default id was `codingchild_<kind>_<attempt>`. The first coding run in a
database worked; **every run after it was refused `DUPLICATE_CHILD` before
registering its first child.** Unit tests never saw it because each builds a fresh
in-memory journal and never has a second run. Ids are now
`codingchild_<runId>_<kind>_<attempt>` — still deterministic, so a resumed run
reuses its completed children rather than duplicating them.

**2 — A terminal run accepted cancellation.** `POST /cancel` answered `200` for a
finished run while the durable write silently failed (a terminal parent refuses
further writes), leaving a caller believing it had stopped something already ended.
It now answers `409 invalid_state`.

Both have regression tests.

## What this does not prove

- **Not real-model competence.** Scripted provider throughout.
- **Not the live-model installed run.** Still blocked by WSL host/pinned-memory
  availability during model loading; no live-model claim is made.
- **Not scale.** One small fixture, one workspace root, one repair round.
