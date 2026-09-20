# kreyol-normalizer

Orthographic post-processing for Haitian Creole speech-to-text. **Frozen at v1.**

One copy, two consumers. `apps/pilot-web/scripts/transcribe.py` (Command Center voice input)
and `services/speech-runtime/server.py` (the runtime behind the Brain, and therefore behind
the consumer MigraPilot app) both load this directory. A second vendored copy in either app
would be how the two surfaces start disagreeing about what a speaker said — the same island
problem `packages/shared-types` exists to prevent.

## What it does

Whisper transcribes Kreyòl into a mix of French and IPN 1979 spellings, because that is what
its training data looks like. Measured on the corpus, the changes it actually makes are:

| family | share | real examples |
|---|---|---|
| `ACCENT_NORMALIZATION` | 88/133 | `fet`→`fèt`, `korek`→`korèk`, `chef`→`chèf`, `senate`→`senatè` |
| `NASAL_OR_GLIDE_RESTORATION` | 36/133 | `ansam`→`ansanm`, `zami`→`zanmi`, `violasyon`→`vyolasyon`, `radio`→`radyo` |
| `FRENCH_ORTHOGRAPHY_TO_IPN` | 8/133 | `bas`→`baz`, `leglis`→`legliz`, `pose`→`poze` |
| `APOSTROPHE_CLITIC_NORMALIZATION` | 1/133 | `l'espri`→`lespri` |

Kreyòl ASR error is overwhelmingly an **accent** problem (à/è/ò), not a wholesale spelling
problem. Those are errors on words the model heard correctly, and they are repairable.

A replacement is emitted only when the candidate is **attested** in the frozen lexicon, is
the **unique** candidate under a constrained edit, and the source is **not a proper name**.
No confidence, no change.

## What it must never do

Repair semantics. If Whisper heard the wrong *word*, this leaves it alone. A nicer-reading
sentence the speaker did not say is the exact failure the language handling in both callers
exists to prevent.

## Measured

Sealed holdout of 33 clips, transcribed before the rules were written and not inspected until
they were frozen:

| | raw | normalized |
|---|---|---|
| WER | 0.524 | **0.481** |
| CER | 0.130 | **0.106** |

precision **1.000** · harm rate on already-correct tokens **0.000** · recall on the
orthographic error subset **0.217**

Across all 94 clips it has never damaged a token that was already correct.

## What that licenses, and what it does not

Good enough to show a user: it improves transcripts and has never corrupted one.

**Not** good enough to author a corpus from. At 0.48 WER a native author still corrects about
one word in two, which is slower than typing. Speech-first GOLD authoring was measured
against a 0.20–0.25 WER criterion and missed it.

## Do not "improve" this in place

Every remaining miss is a token where either no attested candidate exists, or **several do
and the rule correctly refuses**. Raising recall means choosing between attested candidates —
semantic guessing, a different instrument, needing its own sealed holdout.

Any edit that changes `normalized_text` for any vector in `normalizer-frozen-vectors.jsonl`
is a **new version**. `npm run pilot:kreyol:verify` (inside `pilot:verify`) fails closed on it.

## Provenance

`PROVENANCE.json` — checksums, qualification record, licence acknowledgment. The lexicon is
CMU-derived; evaluation audio comes from the CMU Haitian Creole speech corpus, CMU Language
Technologies Institute © 2010, MIT licence, condition 5 provenance acknowledgment.
