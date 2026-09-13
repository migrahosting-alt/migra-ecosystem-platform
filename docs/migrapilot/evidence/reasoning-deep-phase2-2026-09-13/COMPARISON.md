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

---

## 🚨 CONTENTION: quality held, operational behaviour collapsed

`qwen3:14b`, identical frozen suite, with a concurrent `qwen3:8b` load as the
workstation floor.

| | idle | **under floor** |
| --- | ---: | ---: |
| every dimension score | *unchanged* | **identical** |
| coverage | 100% | **100%** |
| load/unload transitions | **0** | **55** 🚨 |
| residency | 100% | **44%** 🚨 |
| warm median | 9 s | **18 s** (2×) |
| warm p95 | 58 s | 66 s |
| cold | 100 s | 108 s |

**The model was evicted and reloaded 55 times across 54 items — roughly once per
item.** Residency more than halved and warm latency doubled.

The cause is arithmetic, and it is not fixable by tuning:

```
device total          24576 MiB
qwen3:14b  peak      ~15163 MiB
qwen3:8b   peak      ~10967 MiB
both resident        ~26131 MiB   → exceeds the card by ~1555 MiB
```

They cannot coexist. Ollama therefore evicts one to load the other, continuously.

**This is the same pathology that disqualified `qwen3:8b` as a default earlier** —
churn producing unpredictable latency — reproduced in `qwen3:14b` the moment the GPU
stopped being idle. On an idle card the 14B is exemplary: zero transitions, 100%
residency. Under the real floor it thrashes.

🚨 **The quality result is unaffected and should not be read as reassurance.** Scores
were identical under both conditions, which means the suite measures capability
independently of load — exactly as intended — and says nothing about whether a
15.9 GB model belongs on a shared 24 GB card.

### A gap in this measurement, stated rather than glossed

Device-level telemetry (`nvidia-smi`: pre-load free, minimum free VRAM during
generation, eviction of other compute processes, utilisation) **was not captured** —
the collector never started, and it was written to emit only at the end, so an
interruption loses everything. The same fragility class as the earlier harness
defects, this time in the instrumentation rather than the scorer.

What is recorded above comes from the suite's own per-generation sampler and from the
capacity arithmetic, both of which are sufficient for the eviction finding. The finer
device-level fields are **not** evidence I hold, and are listed below as outstanding.

---

## Licence and provenance

Read from the model manifests via `/api/show`, which is more than `/api/tags` carries
and still **not an authoritative upstream attestation**:

| | `qwen3:14b` | `qwen3:8b` |
| --- | --- | --- |
| licence text present | yes, Apache License (11,305 bytes) | yes, identical |
| `general.license` tag | **absent** | `apache-2.0` |
| publisher / repo URL | **absent** | **absent** |
| upstream source attestation | **absent** | **absent** |

🚨 **Two gaps that block signing, independent of any capability result.**

1. **This is a redistributor's claim.** The licence text is what the Ollama registry
   serves. Nothing here is signed by the publisher, and `qwen3:14b` does not even carry
   the machine-readable licence tag its sibling does.
2. **The digest does not identify the weights.** `/api/tags` reports the **manifest**
   sha256, and `model_info` contains no provenance keys at all — only
   `general.quantization_version`. So there is no recorded mapping from the digest an
   approval would bind to a publisher-attested artifact.

An approval binds a digest precisely so it cannot transfer to bytes nobody evaluated.
A digest that identifies a redistributor's manifest, with no chain to the upstream
publisher, weakens that guarantee — and that is a **governance** finding, not a model
one. It applies to every candidate equally.

---

## Not run, and recorded as not run

- **device-level contention telemetry** (`nvidia-smi`: minimum free VRAM, eviction of
  other compute processes, utilisation). The collector never started and was written to
  emit only at the end. **Not re-run**, per the owner's instruction not to spend further
  GPU confirming what the capacity arithmetic and 55 transitions already establish.
- **cold-start trials under contention.**

Neither changes the conclusion. Both are listed so that the absence is a recorded fact
rather than an unnoticed gap.

**`reasoning.deep` QUALIFICATION IN PROGRESS — NO APPROVAL PERMITTED.**
