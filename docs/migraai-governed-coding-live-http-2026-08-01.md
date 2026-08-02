# MigraAI Governed Coding — Live HTTP Production-Path Evidence

**Date:** 2026-08-01 · **Mode:** real mounted Brain server, scripted provider · **Production touched:** none

> **This records one repeatable run of the production HTTP path with a SCRIPTED
> provider.** It proves the system — routes, journal, approval boundary, mutation
> engine, validation, repair loop, reconciliation — works end to end. It proves
> nothing about how well a real model chooses; that is separate capability
> evidence, tracked against
> [`migraai-governed-coding-live-acceptance-2026-08-01.md`](./migraai-governed-coding-live-acceptance-2026-08-01.md).

## What was exercised

A real `node dist/src/server.js` process with the coding capability enabled,
driven over HTTP exactly as a client will drive it. Nothing in the harness reaches
into the engine.

| Item | Value |
|---|---|
| Branch | `feat/governed-coding-extension-surface` |
| Server | `dist/src/server.js`, real Fastify, real SQLite journal (schema v7) |
| Provider | scripted HTTP `/api/chat` on loopback |
| Fixture | `test/fixtures/multifileCodingFixture.ts` → throwaway git repo |
| Validation command | `node --test --test-reporter=tap test/orderTotals.test.js` (from configuration, never model-authored) |
| Manual intervention | **one scope approval, nothing else** |

## The flow, as observed

```
capability  {"available":true,"approvalMode":"scope","progressMode":"polling","workspaceRootsConfigured":1}
start       202 codingrun_0b7b3ba3… phase=planning
planning    → awaiting_scope_approval rev=7 hash=590eb93b42d7bc73
  scope     src/contracts/orderTotals.js, src/services/orderTotalsService.js, src/routes/orderTotalsRoute.js
  excluded  src/services/orderTotalsFormatter.js
  mutation  none before approval ✓
approve     200 rev=8
```

Children, in the order they became terminal:

| Child | State | Category |
|---|---|---|
| `repository_planning#1` | completed | observed_success |
| `initial_model_proposal#1` | completed | observed_success |
| `initial_model_proposal#2` | completed | observed_success |
| `initial_apply#1` | completed | observed_success |
| **`validation#1`** | **failed** | **observed_failure** |
| `repair_model_proposal#1` | completed | observed_success |
| `repair_apply#1` | completed | observed_success |
| `validation#2` | completed | observed_success |
| `final_validation#1` | completed | observed_success |
| `reconciliation#1` | completed | observed_success |

Provider calls: `plan → edit:cancelledCount → repair(cites 4)`.

The first edit was deliberately wrong in the same way the real 30B model was wrong
— an invented, self-consistent field name — so the repair loop was genuinely
exercised rather than skipped.

## Verification

| Check | Result |
|---|---|
| `state COMPLETED` | ✅ |
| report `complete: true`, `stopReason: validated` | ✅ |
| repair actually happened | ✅ |
| repair cited **4** immutable evidence ids the run produced | ✅ |
| final report matches the real `git status` exactly | ✅ |
| exactly the three required files changed | ✅ |
| trap file untouched | ✅ |
| independent fixture re-run exits `0` | ✅ |
| no completion blockers | ✅ |
| **zero mutation before approval** | ✅ |

## Defects this run surfaced

Both were found because the path was driven end to end, and neither was visible to
the module suites.

1. **A repaired run could never report complete.** Intermediate `validation`
   children were marked `required`, so a run whose first validation failed — the
   normal repair trigger — was permanently blocked from success. The repair loop
   was effectively pointless. Completion now rests on `final_validation` and
   `reconciliation`; intermediate validations and repair steps are evidence, not
   gates.

2. **The acceptance suite was passing on a validation that never ran.** Tests
   spawned from inside `node --test` inherit `NODE_TEST_CONTEXT`; a child that
   sees it believes it is a subtest, skips the suite, and exits `0`. Validation
   therefore "passed" without executing, and the repair loop never triggered. The
   harness now clears that variable around each awaited run and restores it after.

## What this does not prove

- **Not model capability.** The provider is scripted. A real model's planning and
  repair quality is measured separately.
- **Not the installed extension path.** No extension client, UI, or VSIX exists
  yet. This is the Brain HTTP surface only.
- **Not multi-repository or scale.** One small fixture, one workspace root.
