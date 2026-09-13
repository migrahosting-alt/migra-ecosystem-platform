# `reasoning.deep` candidate audit — 2026-09-13

**Evidence collection only. Nothing here approves anything.**
Design: [`../../REASONING_DEEP_QUALIFICATION_DESIGN.md`](../../REASONING_DEEP_QUALIFICATION_DESIGN.md).

## Catalog facts — established

Read from the Ollama catalog reachable from staging, 2026-09-13. All four candidates are
installed, local and `Q4_K_M`.

| model | size (bytes) | params | digest (first 24) |
| --- | ---: | ---: | --- |
| `qwen3:8b` | 5,225,388,164 | 8.2B | `500a1f067a9f782620b40bee` |
| `qwen3:14b` | 9,276,198,565 | 14.8B | `bdbd181c33f2ed1b31c97299` |
| `qwen3-coder:30b` | 18,556,700,761 | 30.5B | `06c1097efce0431c2045fe7b` |
| `deepseek-r1:32b` | 19,851,337,809 | 32.8B | `edba8017331d15236e57480e` |

**Locality: all four on-device.** Each is orders of magnitude above the 1 MB test that separates
real weights from a cloud manifest (`isRemotelyHosted`). No `-cloud` model is eligible here.

**Hardware fit:** `deepseek-r1:32b` measured at **21.4 GB resident** on a 24 GB RTX 3090 — it
fits, with little headroom for a second resident model. Prior measurement also has the router
already selecting it for the deep tier: `selected deepseek-r1:32b [tier=deep (wanted deep),
reasoning-capable]`.

## 🚨 The first harness was wrong, and its results are void

The first run capped `num_predict` at 900. Reasoning models spend that entire budget inside
`<think>` and never reach the answer, so three items returned **empty** and were scored `FAIL`.

**A qualification harness that scores its own truncation as a model failure would disqualify a
good model.** The corrected harness has `qwen3:8b` answering that identical item correctly
(`09:36`, `done_reason: stop`).

Three requirements went into the evidence contract because of it:

1. record `done_reason`; a truncated item is `TRUNCATED`, never a wrong answer
2. score the **visible** answer with `<think>` stripped — crediting private reasoning that was
   then discarded measures the wrong thing
3. record cold-load and steady-state latency separately

## Controlled-prompt probe — in flight

Five items (multi-step LCM, two-phase rate, trap resistance, strict JSON, fabrication
resistance) across four models, one replication each, temperature 0.

**Read it as a preliminary probe, not a qualification run.** The real suite requires replication,
negative controls, and a pinned `thresholdRevision` — see §3 of the design. Results will be
appended here when the run completes.
