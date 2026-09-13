# `reasoning.deep` candidate matrix — 2026-09-13

**Evidence collection only. No approval issued. Migra Logic remains unavailable.**

Corrected scores, re-scored from stored transcripts with `answerNormalise.ts`. Five items,
one replication, temperature 0, `num_predict` 4000, run from staging against the workstation
Ollama on an RTX 3090 (24 GB).

---

## 🚨 Read this before the table

**Correctness did not discriminate.** After correction, **every candidate passed every item it
completed — 19 / 19.** This probe is too easy to choose a winner from, which is the single most
useful thing it established. The real separation in this data is **cost and predictability, not
quality.**

That is consistent with the owner's standing instruction not to pick from `5/5` alone, and it
means the dimensions that would actually discriminate — `long_chain_stability`,
`constraint_satisfaction`, `plan_ordering`, and negative controls — are exactly the ones this
probe does not contain.

---

## Scores (corrected)

| model | lcm | rate | bat&ball | strict JSON | fabrication | total |
| --- | --- | --- | --- | --- | --- | --- |
| `qwen3:8b` | PASS | **PASS** ¹ | PASS | PASS | PASS | **5/5** |
| `qwen3:14b` | PASS | **PASS** ¹ | PASS | PASS | PASS | **5/5** |
| `qwen3-coder:30b` | PASS | PASS | PASS | PASS | PASS | **5/5** |
| `deepseek-r1:32b` | PASS | PASS | PASS | PASS | **NO-RESULT** ² | **4/4** |

¹ Scored `FAIL` by the original harness. Both models answered **correctly**; they wrote it as
`$$\boxed{36} \text{ minutes}$$` and the scorer wanted the contiguous string `"36 minute"`.
Re-scoring corrected five verdicts across the matrix **without calling a single model again**.

² 🚨 **NOT A FAILURE — THE HARNESS GAVE UP.** The request returned at **780,259 ms**, which is
exactly the harness's 780-second curl timeout, with `done_reason: parse_error` and zero
characters. The model was still working when the measurement was abandoned.

It is reported as `NO-RESULT(timeout)` and **excluded from the score**, because a harness limit
is not a model verdict. It is, however, decisive **cost** evidence: `deepseek-r1:32b` could not
answer a one-sentence question inside thirteen minutes.

---

## Cost and predictability — where the candidates actually differ

| model | first call | median of rest | fastest | peak VRAM | headroom on 24 GB | resident after gen |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `qwen3:8b` | 247 s | 190 s | 7 s | 11.5 GB | **12.5 GB** | **2 / 5** 🚨 |
| `qwen3:14b` | 55 s | 31 s | 8 s | 15.9 GB | **8.1 GB** | **5 / 5** |
| `qwen3-coder:30b` | 33 s | 6 s | 2 s | 23.3 GB | **0.7 GB** 🚨 | 5 / 5 |
| `deepseek-r1:32b` | **776 s** | 168 s | 139 s | 23.0 GB | **1.0 GB** 🚨 | 3 / 4 |

**VRAM is sampled after each generation**, so a zero means the model had already unloaded. It is
a lower bound and a load/unload signal — not a measurement of peak use. The suite must sample
*during* generation; recorded as a gap.

### What the numbers say

- **`qwen3:8b` is not "comfortable once warm" — it churns.** Resident after only 2 of 5
  generations, which is why its latency swings 247 s → 190 s → 7 s. A user-facing family whose
  latency varies by 35× depending on whether the weights happen to still be loaded is not a
  predictable product promise.
- **`qwen3:14b` is the only candidate that was resident for every generation**, at 15.9 GB with
  **8.1 GB of headroom**. Median 31 s, fastest 8 s.
- **`qwen3-coder:30b` is the fastest by a distance** (median 6 s) and leaves **0.7 GB** of
  headroom. It is also a *coder* model being considered for a reasoning family.
- **`deepseek-r1:32b` is the most expensive by an order of magnitude** — 776 s cold, 168 s median,
  and a final item that **never returned at all** inside a 780-second ceiling. It answered
  correctly everything it managed to answer.

---

## What this does **not** establish

- **Nothing about behaviour under the real workstation background floor.** Every measurement here
  was taken with the GPU otherwise idle. Contention is the owner's stated criterion and is
  untested.
- **Nothing about whether a candidate monopolises the GPU** to the detriment of other MigraAI
  workloads. The two >23 GB candidates plainly cannot share the card; the smaller two were not
  measured against a concurrent load.
- **Nothing about failure rate.** One replication per item measures capability, not reliability.
  A model that is right four times in five passes this probe identically to one that is always
  right.
- **Nothing about quality by dimension**, because the probe has five items and the proposed
  contract has ten dimensions.
- **No licence or provenance check** was performed.

---

## Method, and its known defects

Run by `audit2.py`; transcripts in `audit2-raw.txt`; re-scored by `answerNormalise.ts`, which is
committed with its own tests.

Two harness defects were found **by the harness disagreeing with reality**, not by review:

1. `num_predict` capped at 900 — reasoning models spent it inside `<think>` and never reached the
   answer. Three items returned empty and were scored `FAIL`. Those results are void.
2. Substring matching scored two correct answers as failures (note ¹).

Both are now permanent requirements of the evidence contract, along with recording `done_reason`,
stripping `<think>` before scoring, separating cold from warm latency, and retaining full
transcripts so a scoring error costs a re-score rather than another hour of GPU.

**A third defect was found by the final row**, and it is the same mistake a third time: the
re-scorer mapped a timed-out request to `UNCLEAR`, i.e. scored an infrastructure outcome as
model behaviour. `TRUNCATED`, `NO-RESULT(timeout)` and `NO-RESULT(empty)` are now distinct from
every model verdict.

Three separate times in one audit, this harness blamed a model for its own limits — truncation,
formatting, and now a timeout. That is the strongest possible argument for the owner's rule that
**qualification infrastructure is itself a system under test**, and it is why the discriminating
suite must be built and reviewed before any approval rests on it.

**A fourth defect is still open:** VRAM sampled after generation rather than during it.

---

## The reading I would offer, not a recommendation

On the owner's own criterion — *"a slightly smaller model with predictable latency and headroom
over a model that barely fits but occasionally gives a better answer"* — **`qwen3:14b` is the only
candidate this data supports**, and it supports it on cost and stability rather than on quality,
because quality did not separate them.

`deepseek-r1:32b`, the model the router already picks for the deep tier, is the **worst** candidate
by every cost measure here while being no better on correctness.

**That conclusion rests on a five-item probe with one replication and an idle GPU. It is not
sufficient to approve anything**, and the discriminating dimensions have not been run.
