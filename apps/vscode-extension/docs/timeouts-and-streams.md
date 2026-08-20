# Long-running work: timeouts, keepalives and terminal states

A local model can spend minutes on one answer. Every default in the chain assumed
seconds, and the result was that MigraPilot could not complete its own **Explain
Code** command against its own local model — the benchmark measured it failing on
deadlines before the model was ever the constraint.

## Two clocks, not one

Conflating them is what produced the defects.

**Patience for silence** — short, and *reset by any sign of life*: a token, a
progress event, a keepalive. It answers *"is anything still happening?"*

```
UI idle  ≤  Brain idle  ≤  provider idle          120s / 120s / 120s
```

Shortest at the UI, because nobody should stare at a dead surface. Keepalives
every 15s mean this never fires while work is genuinely running — two missed
frames still do not trip it.

**Hard ceilings** — long, absolute, never reset. They answer *"how long at most?"*
and are ordered the other way:

```
provider  <  Brain  <  UI                          480s / 540s / 600s
```

The layer **closest to the work expires first**, so the failure is named
accurately. When an outer layer fires first every inner detail is lost and the
user is told something generic and usually wrong.

Both orderings are asserted by `checkHierarchy`, so the numbers cannot drift
apart. The first draft of that function checked only half the chain while
shipping a UI ceiling *below* the provider's — exactly the inversion it exists to
prevent.

## Settings

| Setting | Default | What it bounds |
|---|---|---|
| `migrapilot.requestTimeoutMs` | 120 000 | Patience for **silence** on a stream. Every token and keepalive resets it. |
| `migrapilot.brainTimeoutMs` | 600 000 | Hard ceiling for **one non-streaming request** — Explain, Fix Problems, Write Tests, Commit Message. |
| `migrapilot.brainConnectionTimeoutMs` | 5 000 | Health probe only. Reachability, never generation. |

`brainTimeoutMs` existed before this and was **not declared in the manifest**,
hard-defaulted to 30s. It governed four commands that no local model finishes in
30s, and no user could raise it through any documented setting.

Brain-side: `MIGRAPILOT_PROVIDER_RESPONSE_TIMEOUT_MS` (480 000) bounds a
non-streaming generation. It is distinct from the connect budget because they
measure different things — connect to a local provider takes under a millisecond,
generation takes minutes — and using connect as the total is precisely what turned
a model *still generating at 58s* into an HTTP 500 at 60s.

## Five terminal states

| State | Meaning |
|---|---|
| `completed` | The engine signalled a normal end. |
| `failed` | The work ran and genuinely failed. |
| `timed_out` | A deadline fired **while the work was still running**. Not a failure of the answer. |
| `cancelled` | A human stopped it. The downstream request was aborted. |
| `stream_interrupted` | The transport died mid-answer. What arrived is **partial**. |

Two rules the old behaviour broke in both directions: **a timeout is never
reported as a model failure**, and **a client that stopped listening is never
reported as a success**. The engineer stream used to fall out of its loop and
return *normally* when the connection died, so a truncated result was
indistinguishable from a finished one.

## Cancellation reaches the work

`complete()` previously ignored the caller's abort signal entirely, so pressing
Stop closed the UI and left the model running to completion with nobody waiting
for the answer. It now takes the signal, and a test asserts against a real HTTP
provider that the downstream request is aborted (`aborted: 1, completed: 0`) —
no orphan generation.
