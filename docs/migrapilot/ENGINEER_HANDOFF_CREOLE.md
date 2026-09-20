# Engineer handoff — Haitian Creole generation quality

Owner-routed 2026-09-20. The Chat lane is **done** here; these two defects are
model/Engineer work. Full evidence: `CHAT_CAPABILITY_CONTRACT.md` §31, §31b, §31c.

## What the Chat lane already established, so you don't re-derive it

The plumbing is not the problem. Measured, not assumed:

- **The user's text reaches the model byte-for-byte.** Every `toLowerCase`/normalize
  call in the chat path builds a local for classification; the outbound text is
  passed through unmodified.
- **Conversation context works.** Live, same build: "my favourite number is 47" →
  recalled; "actually it is 51, not 47" → **answered 51**. English
  correction-following is intact.
- **Language-intent gating is fixed** (Defect 1, commit `368eea36`, staging release
  `creole-intent-0920`). The Creole hint now ships on greeting INTENT rather than on
  a greeting word appearing anywhere in the sentence.
- **Conversation language is preserved correctly** — a Creole thread stays Creole.

🚨 **Keep the Defect 1 gate even if the model improves.** It fixed a real
prompt-construction bug that is independent of model quality: an English sentence
containing a Creole word used to flip the whole reply into Creole, so a user could
not correct their way out of a loop. Five regression cases guard it in
`test/languageHintScoping.test.ts`, negative-checked in both directions.

## DEFECT 2 — Creole generation quality

**Acceptance target, as set by the owner:**

> For ordinary Haitian Creole conversation, the model must distinguish `Bonjou`
> from `Bonswa`, preserve correct Haitian orthography, follow corrections without
> drifting, and produce natural grammatical Creole across at least several turns.
> Test both standalone greetings and normal conversational continuations.

### Reproductions already captured

| input | output | fault |
| --- | --- | --- |
| `bonjou` *(good morning)* | `Bonswa, kijan ou ye? Sak pase?` | wrong time of day |
| `bonjou` ×4 samples | 2 correct, 2 drift to French — one fully `Bonjour ! Comment ça va ?` | language drift |
| `it suppose to be Bonswa` (in a Creole thread) | `Mèsi. Jou reyis se yon jounen mwens konsa. Chak bagay se bonmen.` | malformed |

Earlier turn, same family: `Pou sa fe yon tout bagay yon konfizyon. Si wè, Bondyè
proteje nou.` — two stray `yon`, `Si wè` not meaningful, `Bondye` misspelled.

### Two facts that are probably the same fact

The served model is **`llama3.1:8b`** (tier `balanced`,
`selected llama3.1:8b [tier=balanced (wanted balanced)]`). Alternatives present:
`qwen3:8b`, `qwen2.5-coder:14b`, `qwen3:14b`. A previous Chat-lane probe found
`qwen3:14b` the best available and **still unreliable** — that was a small sample
and is a starting point, not a verdict.

Creole fails *toward French*, its nearest high-resource neighbour. §30 records the
OCR stack failing the same way for the same reason, with `fra` standing in for
`hat`. Two subsystems, one root shape: **Creole is being approximated by French.**

## DEFECT 3 — unsolicited translation

**Acceptance target, as set by the owner:**

> Do not append an English translation unless the user asks for one, except where a
> specific product feature explicitly requires bilingual output.

Nothing in the prompt path asks for a translation; the model volunteers it. This is
not cosmetic. On the owner's own turn it rendered `Mèsi` ("thanks") as *"No worries"*
and **silently dropped the ungrammatical clause entirely** — so a reviewer who does
not read Creole sees fluent English and signs off a broken turn. **It makes bad
Creole invisible to exactly the people most likely to approve it.**

## Status this handoff leaves behind

| item | state |
| --- | --- |
| Creole greeting intent | **FIXED**, staging-proven |
| Haitian Creole generation quality | **OPEN** — Engineer/model |
| Unsolicited translation | **OPEN** — Engineer/model behaviour |
| Chat acceptance for Creole conversation | **FAILED from the user's perspective** |
| Production promotion | **BLOCKED** — Brain lineage reconciliation |
