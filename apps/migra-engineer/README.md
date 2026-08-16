# Migra Engineer

The intelligence-development system behind MigraPilot: evaluation, benchmarking,
and capability qualification.

MigraPilot is the product. Migra Engineer decides what intelligence that product
is allowed to use. They are separate on purpose:

```
        MIGRA ENGINEER                      MIGRAPILOT
  train / evaluate / qualify   ──►   route / serve / persist / ship
```

## The promotion rule

A candidate does not reach users by existing. It reaches users by earning a
named capability:

```
candidate → evaluate → benchmark vs production → qualify for a capability
          → register approved version → controlled routing
```

Permanently: **trained ≠ qualified. installed ≠ approved. newer ≠ better.**
A model may qualify for `software_engineering` and not for `general_chat`.
That is the expected outcome, not a failure.

## Conversation quality (`eval/conversation-quality`)

The suite exists because MigraPilot once passed every technical test it had
while telling a French speaker it was "un assistant de codage" and answering
Haitian Creole in Indonesian. No API test saw it. A human typing `sak pase?`
saw it instantly.

So this is a **product** gate, and everyday human conversation is part of it.

```bash
# what users actually get, end to end
EVAL_OWNER_SCOPE=user:<sub> EVAL_WORKSPACE_SCOPE=personal:<sub> \
EVAL_OWNED_FILES=migration-notes.md \
node run.js --target brain --out baseline.json

# a raw candidate, before it has earned a route
node run.js --target ollama --model qwen3:14b --only haitian_creole
```

### What is automated, and what is deliberately not

A check is automated only where a machine can genuinely decide it. "Did it
answer in French" is decidable from function words. "Is this Haitian Creole
grammatical and natural" is **not** — not by string matching, and not by asking
the same family of model that failed in the first place.

Those cases are reported as `needs-human` with the reply attached, and they
never count as passes. An eval that guesses would manufacture confidence about
the exact capability being measured, which is worse than having no eval.

`--out` writes a machine-readable report for the promotion record. It names the
suite version, because "passed the eval" means nothing later without it.

## First capability under development: `haitian_creole`

Production `qwen3:8b` identifies Haitian Creole (after the Brain persona fix)
but does not write it well. That is a model-competence problem, not a prompt
problem, and it is the first capability to go through the full loop:

```
real failures → evaluation set → corpus/dataset → training/adaptation
             → re-evaluate → compare with qwen3:8b → human review
             → qualify → route Haitian Creole traffic
```

Until a candidate qualifies, Haitian Creole traffic stays on the incumbent.
A weaker experimental model does not get production traffic for being newer.

## MKES_STRESS — Haitian Creole speech stress set (`datasets/mkes-stress`)

Part of **MKES**, the Migra Kreyòl Evaluation Suite. This is the spoken stress
subset.

```bash
npm run mkes:status
```

### Case vs variant

A **case** is a linguistic unit: one authored utterance, one reference
transcript. A **variant** is a recording of that same utterance under one
acoustic condition.

```
MKES_STRESS_004   Kreyòl + English code-switching
  reference: <one authored transcript>
  variants:  clean → MKES_STRESS_004_codeswitch_en.wav
             noise → MKES_STRESS_004_codeswitch_en_noise.wav
```

The transcript is **not** duplicated per variant. Same speaker, same words,
different microphone conditions — hold the language constant, vary only the
acoustics. That is what makes it usable ASR evidence.

Each take is still reviewed **independently**: two takes of one script are not
one performance. A speaker hesitates, drops a word, or self-corrects on one and
not the other, and that deviation is data (`spokenDeviation`), not an error to
tidy away.

Current conditions: `clean`, `phone`, `noise`, `distance`.

### `MKES_STRESS_011` is not a speech case

Room tone with no speech, modelled as a separate type with no transcript field
at all. WER against it would be meaningless. The measurement is *did the system
produce anything at all* — many ASR models invent plausible words from room
noise, and one that transcribes silence into fluent Kreyòl is broken in a way no
speech-accuracy metric would reveal.

Its expected transcript stays `null` until a human confirms by listening.
Asserting "empty" for an unheard file would be inventing the ground truth.

### Source evidence is immutable

Authoritative recordings:

```
/mnt/p/MigraAI-Engineer/training/datasets/kreyol-speech-source/raw
```

Never relocated, renamed, normalised, resampled, or edited in place. This
catalogue **references** them by measured filename, size, SHA-256 and format.
Derived audio (denoised, resampled, segmented) belongs under a derived or export
path and never returns to `raw`.

The Cubase `.cpr` files are session assets for re-editing a recording. They are
**not** a pipeline dependency: the dataset consumes stable WAV artifacts plus
hashes, so evaluation never requires opening a DAW.

That mount is drvfs. It is read-only from here, and there is a standing rule
never to edit it in place.

### Held out, on purpose

Each case targets a named capability — what makes it valuable as a benchmark and
disqualifying as training data. `datasetRole: 'held-out-evaluation'` and
`trainingEligible: false` are in the schema so this survives someone forgetting
the convention. Training material is built separately around the same categories.

### Nothing is asserted before it exists

`referenceTranscript` is `null` until its author supplies it. Duration, sample
rate, hash and format are measured from the file. Speaker identity, emotion,
transcription confidence and ASR metrics are absent fields until measured.

### Rules a "helpful" pipeline would break

- **Code-switched words stay code-switched** — `server`, `crash`, `check logs`
  stay English; `rendez-vous`, `pièce d'identité` stay French.
- **Self-correction stays intact** — `... madi ... non, tann, se te mèkredi ...`
  keeps the mistake *and* the repair.
- **Haitian place names keep their Creole surface form** — `Jakmèl`, not Jacmel.
- **Instruction order is the measurement**, not just the verbs present.
- **No emotion label is inferred from text.**
- **The reference is never edited to improve a score.**

### When a candidate is scored

```
file validation → hash check against catalogue → consent/provenance validation
→ transcription → reference comparison → WER → CER
→ code-switch accuracy → named-entity accuracy
→ number/date/currency accuracy → per-condition comparison
→ human linguistic review
```

### Consent

Permitted uses are enumerated per entry. **Voice cloning is withheld explicitly
and always**: consenting to contribute speech to a dataset is not consenting to
have your voice synthesised.
