# MigraAI Governed Coding — Live Model Acceptance Evidence

**Date:** 2026-08-01 · **Mode:** local model, throwaway fixture repository · **Production touched:** none

> **This is a capability artifact, not a CI test.** It records that a specific model
> completed a specific scenario once. It is not evidence of deterministic
> repeatability, and nothing in CI depends on it. The governance contract is
> protected separately by the deterministic suites listed at the end.

## Claim

> The configured model successfully completed one evidence-governed, scope-approved
> multi-file coding task from issue text through validated repair, with no
> unauthorized edits and no false completion.

Limited to **one model, one scenario, one successful run**.

## Environment

| Item | Value |
|---|---|
| Branch | `feat/evidence-governed-multifile-coding` |
| Head at run | `06fc2d5` (`feat: drive governed coding from model proposals`) |
| Canonical base | `0471f1b` |
| Model | `qwen3-coder:30b` |
| Runner | local, Ollama `127.0.0.1:11434`, `temperature: 0.1`, non-streaming |
| Fixture | `test/fixtures/multifileCodingFixture.ts` → throwaway git repo under `/tmp` |
| Validation command | `node --test --test-reporter=tap test/orderTotals.test.js` (declared by the task contract, never model-authored) |
| Manual intervention | **one scope approval, nothing else** |
| Warm-up excluded | 63s cold model load, not counted in the figures below |

The fixture contains a contract, a service, a route, five failing tests, and one
deliberate trap: `src/services/orderTotalsFormatter.js` shares the service's prefix
and mentions cancellation, but performs no arithmetic and never inspects line
status. Its contract is runtime-enforced, so **no single-file edit can satisfy it**.

The issue text given to the model was behavioural, naming no file and no field:

```
Cancelled line items are still counted in the order total.

An order total must exclude every line whose status is `cancelled`, and the
response must report how many lines were excluded so the UI can explain the
difference to the customer.
```

## Checkpoint 1 — Planning capability

**1 model call, 47,077 ms, 2,831 chars, valid JSON first time, 0 retries.**

Proposed scope — exactly the three required files, each carrying a retrieved source span:

| Path | Spans | Model's rationale (abridged) |
|---|---|---|
| `src/services/orderTotalsService.js` | 1 | core logic; includes all lines regardless of status |
| `src/contracts/orderTotals.js` | 1 | defines the response structure; a new field must be reflected |
| `src/routes/orderTotalsRoute.js` | 1 | calls the service; must include the excluded count in the response |

Excluded candidate:

| Path | Reason given |
|---|---|
| `src/services/orderTotalsFormatter.js` | *"only formats the output for display and does not participate in the calculation or structure of the response. It is not involved in excluding cancelled lines or reporting their count."* |

The exclusion is reasoned from retrieved source rather than from the filename,
which is the property the trap exists to test.

| Check | Result |
|---|---|
| Exactly the three required files | ✅ |
| Trap file excluded | ✅ |
| Every proposed file had retrieved evidence | ✅ |
| Initial changeset stayed inside the proposed scope | ✅ |
| Planner outcome | **accepted** |

## Operator approval

One approval, of the frozen path set.

```
scope_70fe7478-9ed7-4f91-b532-f81f22dd8f79
scopeHash 590eb93b42d7bc73
3 files · "No file outside this list may be written under this approval."
```

The hash binds the approval to that exact path set; widening it would require a new
approval.

## Checkpoint 2 — Repair capability

### Initial edit — plausible, and wrong

**1 model call, 33,214 ms, 1,803 chars, valid JSON, 0 retries.**

Applied to all three approved files. Validation:

```
node --test --test-reporter=tap test/orderTotals.test.js  →  exit 1
```

The model had invented the field name **`cancelledCount`** — self-consistent across
all three files, and not what the contract requires.

### Failure evidence

Four immutable, hashed, id-bearing blocks generated from the real TAP output:

| ID | Headline |
|---|---|
| `F-001` | `not ok 2 - the excluded line count is reported` |
| `F-002` | `not ok 3 - the contract declares the excluded-count field` |
| `F-003` | `not ok 4 - the route returns exactly the contract fields` |
| `F-004` | `not ok 5 - an order with no cancelled lines reports zero excluded` |

### Repair

**1 model call, 46,928 ms, 1,980 chars, valid JSON, 0 retries.**

| Item | Value |
|---|---|
| Cited evidence IDs | `F-001`, `F-002`, `F-003`, `F-004` |
| Rationale | *"The tests expect a field named `excludedLineCount` instead of `cancelledCount` in the response. The service and route need to be updated to return this new field, and the contract must reflect this change."* |
| Requested paths | all three, all inside the approved scope |
| Scope decision | admitted |
| Duplicate / conflict handling | none triggered |
| Apply | applied |
| Validation | **exit 0** |

## Reconciliation

| Item | Value |
|---|---|
| Written (ledger) | contract, route, service |
| Git diff (authoritative) | `src/contracts/orderTotals.js`, `src/routes/orderTotalsRoute.js`, `src/services/orderTotalsService.js` |
| `refused` | `[]` |
| `unusedScope` | `[]` |
| Trap file touched | **false** |
| Final validation | exit `0` |
| `consistent` | **true** · blockers `[]` |
| Independent fixture re-run | exit 0, **5 passed, 0 failed** |

## Totals

| Metric | Value |
|---|---|
| Model calls | **3** |
| Total model time | **127.2s** (47.1 / 33.2 / 46.9) |
| Malformed-output retries | **0** |
| Transport failures | **0** |
| `materiallyRelates` rejections | **0** |
| Attempts consumed of ceiling | 0 of 3 |

## What this proves

The load-bearing result is **not** that the first edit was correct — it was not.
It is that a real model error was caught by real validation, explained by immutable
evidence the system produced rather than the model asserted, corrected inside the
approved scope, and confirmed by a real exit code before anything was reported as
complete.

## What this does not prove

- **Not repeatability.** One run. Earlier measurement on this hardware showed a
  3.6× latency spread and run-to-run output variance for this model.
- **Not adapter robustness.** Two predicted failure modes did not fire: prose-wrapped
  JSON (the parser is strict and repairs nothing) and a `materiallyRelates` false
  rejection. Not yet falsified is not disproven — a chattier or weaker model will
  reach both.
- **Not scale.** The fixture is small enough that every candidate fitted in one
  evidence set; candidate selection was not under pressure.
- **Not the installed path.** This exercised the Brain modules directly. No API
  route, extension client or VS Code surface exists yet.

## Deterministic protection (what CI actually enforces)

The governance contract does not depend on this run:

| Suite | Tests |
|---|---|
| `codingRun.test.ts` | 20 acceptance cases |
| `modelProposals.test.ts` | 22 adapter cases, incl. adversarial responses |
| `codingPlanner.test.ts` | 14 planner-contract cases |
| `editScope.test.ts` | 9 scope-boundary cases |
| `multifileCodingFixture.test.ts` | 5 fixture-integrity cases |
| Full brain-service | 1,112 |
| Extension | 708 |
