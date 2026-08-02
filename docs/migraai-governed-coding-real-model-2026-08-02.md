# Governed coding — real-model evidence (2026-08-02)

Model: `qwen3-coder:30b` via local Ollama. Every model call is forwarded to the
real model through a transparent proxy that records the call sequence; nothing is
scripted. Fixture: the three-file `orderTotals` repository with a formatter
"trap" file that must not be edited.

## Why this run existed

The merged milestone (PR #143, #144) was proven with a **scripted provider**. The
real-model run was recorded as pending. When it finally ran, it failed at the
first stage — and the failure was ours, not the model's.

## Defect 1 — the required output shape was never sent (100% reproducible)

The planner refused every real-model run with `malformed-model-output`. The model
was not at fault. It selected the correct three files and wrote correct code, then
returned it as:

```json
{ "fixes": [ { "path": "...", "content": "..." } ] }
```

The parser requires `{issueSummary, scope[], excluded[], edits[]}`. The prompt
never stated that shape. The system message said "matching the requested shape
exactly" while the user message contained only `JSON.stringify(input)` — no shape
was ever requested. All three model call sites (plan, propose, repair) had it.

**A scripted provider cannot catch this, because the script *is* the shape.** It
returns the right keys by construction, so the acceptance suite passed while the
capability was 0% functional with any real model.

Fix: `PLANNER_OUTPUT_CONTRACT`, `PROPOSAL_OUTPUT_CONTRACT`,
`REPAIR_OUTPUT_CONTRACT`, each declared beside the parser that enforces it and
sent as `responseShape`. Planning went from refused-every-time to succeeding in
71.7s on first retry.

## Defect 2 — the stop reason misattributed the cause

`productionCodingDriver` labelled every incomplete run that produced a
reconciliation record as `reconciliation-failed`, including runs whose diff and
ledger agreed perfectly and which simply never made the tests pass. `codingRun.ts`
already got this right. The driver could never emit `repair-ceiling-exhausted`,
so an operator was sent hunting a scope/diff integrity problem that did not exist.

Fix: the driver names the cause it actually hit. `reconciliation-failed` now means
what it says — validation passed and the records still disagreed.

## Defect 3 — the failed-apply path threw instead of reporting

`finish()` is hoisted and closes over `let current`, which was declared *after*
the `initialApply.status !== 'completed'` early return that calls it. That one
path — the only path that exists to report a refused apply — hit a temporal
dead-zone `ReferenceError`. Confirmed by instrumentation:

```
DIAG_FINISH_THREW: ReferenceError Cannot access 'current' before initialization
```

Nothing was falsely claimed (the run still ended non-complete), but the throw
happened *inside* the reconciliation stage, so the journal recorded
`reconciliation: observed_failure` for a reconciliation that never evaluated
anything — a durable record of an outcome nobody computed.

Fix: declarations hoisted above the apply. Reconciliation now records a real
verdict with real blockers.

## Defect 4 — a rejected repair proposal was reported as a refused apply

Two distinct endings were flattened: the model failing to produce a usable
proposal, and the governed write boundary refusing one. Added
`repair-proposal-rejected`.

## Defect 5 — a test that could only pass in CI

`capabilityEnforcement.test.ts` resolved `../../src/...` from `import.meta.url`.
That is correct from `dist/test/` (how CI runs it) and escapes the package from
`test/` (how developers run it), so it failed locally with ENOENT for a file that
was never missing. Same class as the earlier `readSource()` fix.

## Reliability sample — 8 runs on the final build

| Runs | Outcome |
|---|---|
| 3 | `COMPLETED` / `validated` — 3 files changed, trap untouched, independent re-run exits 0 |
| 5 | `FAILED` / `repair-proposal-rejected` |

The failures are **model competence, not governance**. On its second repair the
model hallucinated an Express application into an ESM codebase that never used
Express — `require('express')`, `router.get`, mock data, `res.json` — and cited an
invented evidence id. The boundary refused a proposal that would have destroyed
the files. That refusal is the system working.

## Governance invariants — held in 8 of 8 runs

- final report matched the real `git diff` exactly: **8/8**
- trap file untouched: **8/8**
- no mutation before approval: **8/8**
- **false successes: 0/8**

Not one run claimed completion it could not support, including the five where the
model degenerated.

## Verification

- `apps/brain-service`: **1254 pass, 0 fail** (`npm test`, compiled layout — the
  layout CI runs). Previously 1253/1 with the `capabilityEnforcement` failure now
  fixed.
- Both layouts checked: `tsx --test test/*.test.ts` and `node --test dist/test/*`.
- Defects 2, 3 and 4 each have a regression test verified to **fail** against the
  old code, not merely pass against the new.

## Standing caveat

Real-model success is ~38% on this fixture (3/8). The capability is demonstrated
end-to-end and is honest in every outcome; it is **not yet reliable run-to-run**.
Repair-loop quality — not governance — is the limiting factor.

Reproduce: `<scratchpad>/real-model-e2e.mjs` (transparent proxy, records call
sequence). Raw planner capture: `probe-planner-raw.mjs`.
