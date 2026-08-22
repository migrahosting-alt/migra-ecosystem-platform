# mp-0004 — the persona flipped English answers into malformed Creole

Investigated 2026-08-22 against live `chat.migrateck.com`. Closed by commit `64490c3`.

## 1. Frozen evidence — the occurrence that started this

| field | value |
|---|---|
| conversation | `conv_7vxwwyh4pw43lqby76if9` |
| user prompt | `What is the betaSecret?` (English) |
| user message | `msg_5n7sus83lgdjsfixft6w8` @ `1787383274664` — 2026-08-22T07:21:14.664Z |
| assistant message | `msg_2x2x4ynuinh171kmqdh2on` @ `1787383279504` — 2026-08-22T07:21:19.504Z |
| generation time | 4 840 ms |
| grounding state | `groundingFiles: []` — ungrounded, `groundingMode: none` |
| consumer build | `6411a35` |
| Brain build | `00f75d9` (`ExecMainStartTimestamp` 07:19:28 UTC — 1 m 46 s before the turn) |
| model | `qwen3:8b` |
| provider | `openai-compat`, `http://100.86.143.93:11434/v1` (workstation Ollama over Tailscale) |
| sampling | none sent — `{model, messages, stream}` only, so model defaults applied |

Assistant response, verbatim:

> Piti piti, ou pwofonde nan yon moun ki gen yon pwogram, yon proyet, oswa yon konsept ki gen yon "betaSecret"? Pou m kapab wè ak pèmèt ou, pouvite m konnen plis sou lekè ou nan yon manir ki gen sòti an? 😊

This does not form coherent Haitian Creole. `ou pwofonde nan yon moun`, `pouvite m konnen` and
`nan yon manir ki gen sòti an` are not natural constructions. It is Creole-shaped nonsense, which
is why it was treated as a product defect and not a style preference.

**Not available from the browser, by design.** The consumer's stream route relays only `token`
frames; `route` frames carrying model id, provider and failover history are deliberately withheld
from the client. Model provenance above was read from the Brain host, not inferred.

## 2. Replication matrix — 20 turns through the real product

Same route the UI calls (`POST /api/chat/stream`), same session, same body shape
(`{prompt, attachments?, conversationId?}`), one fresh conversation per turn.

| arm | condition | n | flipped |
|---|---|---|---|
| A | ungrounded, the exact original prompt | 5 | **2** — both malformed Creole |
| C | ungrounded, semantically similar English prompts | 5 | **1** — malformed Creole |
| D | ungrounded, plain English control, no unknown token | 5 | **1** — **French** |
| B | grounded on a neutral English document | 5 | 0 |

Two things this settled immediately:

- **Not deterministic.** Identical input, identical build, different language out.
- **Not Creole-specific and not caused by the unknown word.** Arm D's flip was
  `Explain what a JSON file is.` answered in French. The defect is output-language
  instability with a Creole bias, not a Creole feature misfiring.

Arm B's clean sweep is **not** evidence that grounding fixes this: a grounded turn carries
retrieved English evidence in the prompt, which conditions the output language. It is a confound,
recorded as one.

## 3. Which boundary flips — Brain removed, 12 runs per arm

Direct to the provider, one English question, only the system prompt varied:

| system prompt | flipped |
|---|---|
| none at all | **0 / 12** |
| persona with the Creole-greetings sentence removed | **0 / 12** |
| persona + *only* the French/English disambiguation sentence | **0 / 12** |
| persona + *only* the Haitian-Creole-greetings sentence | **5 / 12** |
| full production persona | **5 / 12** |

**One sentence carried the entire defect** — the clause that named Haitian Creole and quoted six
Creole phrases. Naming and quoting a language in the system prompt raises that language's
probability in the output, on every turn, including the overwhelming majority that were never
about Creole.

So of the five candidate boundaries, the answer is **prompt content at persona assembly** —
not prompt interpretation (no language detector exists in the path), not persona selection
(deterministic on `systemPromptId`), not routing (one model configured), not post-processing
(none exists), and not "the model ignores instructions": the model was following a prompt that
was pulling it the wrong way.

The comment above the clause already recorded that an earlier, longer version had over-corrected
and that shortening it was the fix. **It was not.** The cause is not the sentence's length; it is
that the tokens are present at all on a turn where the user never wrote a word of Creole.

## 4. The fix

The hint now ships **only when the user's own message contains one of those greetings**.
Whole-word matching, which is what keeps French `bonjour` from matching Creole `bonjou` — the
exact over-capture its paired sentence was written to prevent, so the two sentences now travel
together. One constant feeds both the matcher and the prompt text, because two copies drift.

Asserted at the transport boundary in `test/languageHintScoping.test.ts`: the tests read the JSON
body the provider puts on the wire, not an intermediate object.

**What it does not cost, measured rather than assumed:** with the hint absent, `sak pase?` still
came back in Creole 5/5. The Indonesian misreading that originally justified the clause did not
return on this model.

## 5. Found on the way, recorded not folded in

- **The Creole this model produces is poor even when the language is correct.** `Pou lè ou?`,
  `Pase bon, konsa ou?`, `Mwen ap wèt` — with and without the hint. That is a model-capability
  question for the Haitian Creole flagship gate, not a prompt bug, and `qwen3:8b` should not be
  assumed adequate for it.
- **The bare model confabulates on unknown terms.** Direct-to-provider runs produced
  "BetaSecret is an open-source project…" and "BetaSecret is a company known for…". Not observed
  through the product in these 20 turns.
- **58 Brain tests fail locally** on `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be
  a string` — no local Postgres credential. Pre-existing and unrelated, but note that
  `postgresRag.test.ts` *skips* cleanly under the same condition while these *fail*; the skip
  guard is inconsistent across the Postgres suites.
