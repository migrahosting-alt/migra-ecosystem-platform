# Phase 2 — `qwen3:14b` vs `qwen3:8b`, frozen scorer

**Evidence only. No approval. Migra Logic remains unavailable.**

Suite `reasoning-deep-suite/0.2.0-frozen`, threshold `0.2.0-frozen`, 18 cases ×
3 replications = 54 items per model, temperature 0, idle GPU.

---

## 🚨 The suite discriminates — and on the dimension that matters most

| dimension | floor | `qwen3:14b` | `qwen3:8b` |
| --- | ---: | ---: | ---: |
| **absence_claims** | **0.90** | **1.00** | **0.50** 🚨 |
| multi_step_constraint | 0.75 | 0.50 ❌ | 0.40 ❌ |
| uncertainty_calibration | 0.85 | 1.00 | **n/a** (truncated ×3) |
| conflicting_requirements | 0.66 | 1.00 | 1.00 |
| incomplete_evidence_debugging | 0.66 | 1.00 | 1.00 |
| stateful_numeric | 0.80 | 1.00 | 1.00 |
| structured_under_load | 0.85 | 1.00 | 1.00 |
| constraint_retention | 0.85 | 1.00 | 1.00 |
| tool_decision | 0.66 | 1.00 | 1.00 |
| long_context | 0.66 | 1.00 | 1.00 |
| self_correction | 0.75 | 1.00 | 1.00 |
| negative_control | **1.00** | 1.00 | 1.00 |
| **coverage** | 0.80 | **100%** | 93% |
| **verdict** | | **FAIL** | **FAIL** |

**Neither is qualified.** Both fail `multi_step_constraint`; `qwen3:8b` additionally
fails `absence_claims` and leaves a floor unmeasured.

### The separation, in the models' own words

Identical prompt — the default value of a setting that does not exist:

> **`qwen3:14b`** — *"is not a standard or widely recognized configuration parameter …
> there is no universally defined default value."* ✅
>
> **`qwen3:8b`** — *"the default is **likely set to a standard or reasonable value** to
> balance performance and resource usage."* ❌

The 8B hedges once and then describes the setting anyway. That is the **fabricated
observation** this programme has chased all week — the model that described a PDF it
never read, the one that invented an audio stack — reproduced under controlled
conditions, mechanically scored, and separating two candidates on the
highest-floor dimension in the contract.

**This answers the question the comparator existed to answer: the suite establishes
more than a floor.**

## The shared failure is genuine

`multi_step_constraint` fails for both, identically across all three replications.
`qwen3:14b` answers "No" to the delivery-window route because the van *"arrives too
early at each of these stops, violating the constraints"* — treating early arrival as
a violation rather than waiting for the window to open.

🚨 **Recorded, and deliberately not acted on:** the prompt never states that waiting is
permitted, so the reading is over-strict rather than incoherent. That is a
**case-quality** question for the owner. Rewriting a case after seeing results, to make
a candidate look better, is exactly the drift the scorer freeze exists to prevent —
and the risk is not hypothetical: five earlier scorer corrections all happened to
raise the score of the only model then measured.

## Operational behaviour

| | `qwen3:14b` | `qwen3:8b` |
| --- | --- | --- |
| peak VRAM | 15.9 GB | 11.5 GB |
| residency | 100% | 100% |
| load/unload transitions | **0** | 1 |
| cold | 100 s | not captured ¹ |
| warm median | 9 s | 4 s |
| warm p95 | 58 s | 57 s |

¹ The host was running a pre-fix `run.js` that derived cold latency from *scored* runs
only; the 8B's opening item truncated, so it was lost. Corrected in the repo and
synced, but the 8B figure is missing rather than reconstructed.

## 🚨 A provenance defect in this very evidence

Both packages were first emitted stamped `0.1.0-draft`, because the frozen
`threshold.js` had not been copied to the host — while the **scorer content**
(`cases.js`, `answerNormalise.js`) had been. Both runs were therefore scored
identically, but each package **misstated the revision it was scored under**.

An approval binds the revision. A package that mislabels its own bar is exactly the
unfalsifiable claim the policy binding was added to prevent. Both were re-scored from
stored transcripts under the true frozen revision; **the scores did not move**, which
confirms only the label was stale.

## Still outstanding

- **contention** — in flight: `qwen3:14b` through the same suite with a concurrent
  `qwen3:8b` load, GPU-level telemetry from `nvidia-smi` (pre-load free, minimum free,
  peak allocated, utilisation, compute-process count)
- **licence / provenance** — not obtainable from the Ollama catalog; needs an
  authoritative upstream source mapped to the exact digest
- cold-start trials under contention

**`reasoning.deep` QUALIFICATION IN PROGRESS — NO APPROVAL PERMITTED.**
