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

## MKES_STRESS — Haitian Creole stress set (`datasets/mkes-stress`)

Ten authored utterances, each probing a capability models are known to fail:
conversation, Haitian names and geography, dates/money, English code-switching,
French code-switching, self-correction, ordered instructions, prosody, culture,
long-context reasoning.

```bash
npm run mkes:status
```

### Held out, on purpose

Each item targets a named capability. That is what makes the set valuable as a
benchmark and **disqualifying as training data** — train on these, then score
against them, and the number means nothing. `datasetRole: 'held-out-evaluation'`
and `trainingEligible: false` are in the schema so this survives someone
forgetting the convention. Training material is built separately around the same
linguistic categories.

### Nothing is asserted before it exists

`referenceTranscript` is `null` until its author supplies it. Audio duration,
sample rate, speaker identity, acoustic properties, emotion, confidence and ASR
metrics are absent fields until measured — never defaults, never estimates.

A generated reference would silently become the ground truth every future
candidate is scored against. The slots stay empty until the real text arrives.

### Rules a "helpful" pipeline would break

Standard ASR and text normalisation actively destroy what this set measures:

- **Code-switched words stay code-switched.** `server`, `crash`, `check logs`
  stay English; `rendez-vous`, `pièce d'identité` stay French. Translating them
  into Creole produces a transcript nobody said.
- **Self-correction stays intact.** `... madi ... non, tann, se te mèkredi ...`
  must keep the mistake *and* the repair. Reducing it to `mèkredi` deletes the
  phenomenon.
- **Haitian place names keep their Creole surface form** — `Jakmèl`, not Jacmel;
  `Okap`, not Cap-Haïtien.
- **Instruction order is the measurement**, not just the verbs present.
- **No emotion label is inferred from text.** Prosody is evidenced by audio.
- **The reference is never edited to improve a score.**

### When the WAVs arrive

Bind strictly by `MKES_STRESS_###`, then:

```
file validation → audio metadata → provenance/consent validation
→ transcription → reference comparison → WER → CER
→ code-switch accuracy → named-entity accuracy
→ number/date/currency accuracy → human linguistic review
```

### Consent

Permitted uses are enumerated per item. **Voice cloning is withheld explicitly
and always**: consenting to contribute speech to a dataset is not consenting to
have your voice synthesised, and the two must never be collapsed by inference.
