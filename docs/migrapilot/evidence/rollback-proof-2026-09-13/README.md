# Two-way rollback proof — staging — 2026-09-13

**Staging only. Production untouched, and read on every snapshot to prove it.**

Sequence: `readercap-09135 → readfailure-09134 → readercap-09135`, consumer then Brain on each
leg, with an evidence capture after every switch.

---

## Why a new mechanism was needed first

There was no rollback **command**. There was a line the deploy scripts **printed**:

```
ssh $HOST "sudo ln -sfn $PREVIOUS $ROOT/current && sudo systemctl restart $UNIT"
```

It repoints `current` and never touches `previous`. That was survivable while `previous` did not
exist. Once it became a durable recorded pointer the line became **actively wrong**: run it and
both pointers name the same release, so there is no way back from the way back, and retention
sees `rollback == active` and demotes the real spare.

> **A rollback that leaves the pointers incoherent is not a rollback. It is a symlink swap that
> happens to work once.**

`rollback.sh --target <t> --app <consumer|brain> [--to <r>] [--apply]` plans by default, checks
the destination **and the release being left** with the shared completeness predicate, swaps both
pointers together, and asks the running process what it serves. Being its own inverse is what
makes a two-way proof one command run twice.

### Pointer write order

`previous` is written **before** `current`. From `current=A, previous=B`, a death between the two
leaves `current=A, previous=A` — visibly wrong and harmless, because **what is serving has not
moved**. The other order leaves `current=B, previous=B`: the service has moved and the way back
is gone. Not a transaction; it fails on the safer side.

---

## The four snapshots

| | consumer current | consumer previous | brain current | brain previous | prod |
| --- | --- | --- | --- | --- | --- |
| **baseline** | readercap-09135 | readfailure-09134 | readercap-09135 | readfailure-09134 | untouched |
| **leg1-after-consumer** | **readfailure-09134** | **readercap-09135** | readercap-09135 | readfailure-09134 | untouched |
| **leg1-complete** | readfailure-09134 | readercap-09135 | **readfailure-09134** | **readercap-09135** | untouched |
| **leg2-after-consumer** | **readercap-09135** | **readfailure-09134** | readfailure-09134 | readercap-09135 | untouched |
| **leg2-complete** | readercap-09135 | readfailure-09134 | **readercap-09135** | **readfailure-09134** | untouched |

Every snapshot: **both services HTTP 200**. The mixed intermediate states were expected and are
recorded rather than skipped — the two applications are not atomic as a pair, and the evidence
has to show the window.

### Service restarts, showing exactly what moved and when

```
baseline              consumer 05:12:06   brain 05:09:52
leg1-after-consumer   consumer 07:35:23   brain 05:09:52   ← only the consumer moved
leg1-complete         consumer 07:35:23   brain 07:36:05   ← then the Brain
leg2-after-consumer   consumer 07:37:04   brain 07:36:05   ← only the consumer moved
leg2-complete         consumer 07:37:04   brain 07:37:38   ← then the Brain
```

Each leg moved exactly one service at a time, and the untouched one's timestamp is unchanged —
which is the evidence that it was untouched, not an assertion that it was.

---

## 🚨 A release NAME does not identify a source revision

The two services shared the release name `readercap-09135` while carrying **different commits**,
because the Brain was deployed from a worktree before the consumer's later commits landed:

```
consumer  release readercap-09135   commit a56b442b   buildId GZ_pUcwIaNRCUTbOJYCgd
brain     release readercap-09135   commit 69cd2e87   buildId sha256:c0941f37d500bbe1…
```

`readfailure-09134`, by contrast, **is** commit-consistent across both services (`bef9927d`), so
the ambiguity is specific to this pair of deploys rather than general.

**The audit therefore never concludes parity from matching directory names.** Every row above was
read from `/api/version` on the running process, which reports release, commit and build id
together. A rollback proof that compared symlink basenames would have declared these two
services identical.

Longer term this argues for app-specific release identifiers or a manifest that makes the
distinction obvious. **Not renamed before the proof** — changing identifiers during a rollback
exercise would have destroyed the thing being measured.

---

## Production, on every snapshot

```
consumer current : chat-platform-rc-0908
brain    current : chat-platform-rc-0908
consumer started : Fri 2026-09-11 06:31:26 UTC
brain    started : Fri 2026-09-11 06:31:26 UTC
```

Identical in all five captures. "Production was untouched" is a claim, and a claim made once at
the start of an afternoon is not evidence about the middle of it — so the observer reads it every
time.

The observer, `capture-rollback-evidence.sh`, is **read-only and unprivileged by design**: the
thing that judges a rollback leg must not be able to change what it is judging.

---

## The product after the round trip

```
serving: readercap-09135
"Can you read a PDF if I attach one?"
  → Reading documents you attach — partly. PDF, CSV, JSON, Markdown, plain text,
    code and .xlsx spreadsheets… Up to 256 MB per file, and text is read from the
    first 25 MB of it. Scanned or image-only PDFs cannot be read on this server…
```

Back to where it started, and still composing the capability answer from measured runtime state.

---

## Follow-through: the deploy scripts no longer hand out the dangerous command

The proof having passed live, both deploy scripts stopped printing the `ln -sfn … current`
recovery line and now name the governed mechanism. In `deploy-brain.sh` that string is
interpolated into **four** "IS SERVING A DIFFERENT …" failures and the final summary — it is
what an operator copies at the worst possible moment, so handing them a known-dangerous command
there was worse than handing them nothing.

`test-deploy-exit-codes.sh`: **16/16** after the change.

---

**READY FOR OWNER VALIDATION.** Nothing is OWNER VERIFIED. Production was not promoted.
