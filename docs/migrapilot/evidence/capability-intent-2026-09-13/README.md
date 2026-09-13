# P0 — capability self-description routing — 2026-09-13

**Staging only. Production untouched.**

Commits `7f230b5b` (the classifier), `d90a4e8a` (limits from the authority) and `12957cc7`
(the unit contradiction and the limits-question miss), deployed to staging as
`capability-intent-09132`.

---

## What was actually wrong

The capability-owned answer mechanism was working. Its **detector** was a list of
self-referential phrases — `can you`, `do you have`, `are you`, `able to`. Owner validation
broke it in one sitting with two questions that are not exotic:

| asked | what the model said | the truth |
| --- | --- | --- |
| *"Will you remember this conversation after the service restarts?"* | "I do not maintain a persistent memory of individual conversations between service restarts … Each conversation is ephemeral." | Conversations are durable in PostgreSQL and readable from History |
| *"What audio or transcription support is currently available?"* | "Audio Playback — MP3, WAV, AAC. Text-to-Speech… Speech-to-Text… Transcription Services: Integration with third-party tools." | There is no speech runtime on any deployment |

`Will you …` was not in the phrase list. And *"What audio or transcription support is
currently available?"* **never says "you" at all** — no phrase list organised around
self-reference can catch it.

The diagnosis was confirmed at the time by rephrasing: *"Do you remember previous
conversations after a restart?"* returned the correct capability-owned answer. Same
question, same authorities, same renderer — only the detector differed.

**Adding those two strings would have fixed those two strings.**

---

## The invariant now implemented

> Any question whose factual answer is about MigraPilot's own current capabilities,
> configuration, availability, persistence, limits or supported modalities must resolve from
> authoritative capability state before model commentary is allowed. The model may explain
> the facts; it must never originate them.

### Three independent axes, all three required

| axis | question | how it is decided |
| --- | --- | --- |
| **SUBJECT** | is this about *this product*? | explicit (`you`, `MigraPilot`, `this service`), or **implicit** — asking whether a feature is supported / enabled / configured / approved / retained / currently available, which is a property only a system has |
| **FACET** | is it about *state* rather than the world? | ability · availability · persistence · current-state · configuration · limits · modality · negative-indirect |
| **TOPIC** | which capability? | nine capability topics, plus overview |

Requiring all three is what keeps ordinary knowledge ordinary. The implicit-subject route is
what carries owner phrasing #2, which has no self-reference to match.

### Guards, because a false positive is the worse failure

- **explanation / advice** — *"how does X work"*, *"what is an X"*, *"which is best"* is about
  the world. Overridden by a status facet, so *"is your search configured?"* still resolves.
- **task request** — *"write a Python script to parse this CSV"* names a format and is a task.
  Unless it also asks to **run** it or take an **attachment**, which are capability questions
  with a production verb in front (*"can you write and run code for me?"*).
- **domain sense** — `memory` and `audio` collide hardest with ordinary subjects. Each carries
  a domain pattern (*computer memory*, *audio format*, *podcast*, *codec*) and an override
  (*remember*, *conversation history*, *transcription*, *dictation*). The override wins.
- **other product named** — an implicit *"is X supported?"* beside `ChatGPT`/`Excel`/`Adobe` is
  about them.

### 🚨 Low confidence does not guess

A question about this product whose capability does not resolve returns **no topic at all**
and the model answers, exactly as for ordinary prose. Picking the nearest topic would state a
fact about something else **in the product's authoritative voice** — strictly worse than the
model's prose, which at least does not carry that authority.

### 🚨 A registry that did not answer is not an empty registry

`registry: null` used to collapse to *"Web search is not offered here."* — a claim about the
deployment made from no evidence. That is the same defect this module exists to stop, in the
product's voice instead of the model's. It now renders **"not verified"**, which is its own
verdict, not a "no". An **empty** registry is still an answer, and still means not offered.

---

## Verification on the DEPLOYED staging product

Driven through the authenticated owner session in the browser → `/api/chat/stream` → the same
route a person uses. Not the unit tests.

### The two owner-failing phrasings

```
Will you remember this conversation after the service restarts?
  → Remembering earlier conversations — yes. Conversations are saved and readable
    later from History, including after a restart. Within a conversation, earlier
    turns are used as context.                                              [334 ms]

What audio or transcription support is currently available?
  → Transcribing audio — no. No speech runtime is configured. Set
    MIGRAPILOT_SPEECH_RUNTIME_URL to a qualified transcription runtime.     [180 ms]
```

No MP3. No AAC. No "third-party tools". The runtime's own sentence, including the env var an
operator would act on.

### Paraphrase matrix — 22 / 22 capability-owned

Every one is a phrasing that appears **nowhere** in the classifier.

| topic | phrasings that resolved | answer |
| --- | --- | --- |
| memory | *"Do you remember previous conversations after a restart?"* · *"Is conversation history retained between sessions?"* · *"Are my chats saved anywhere?"* · *"Do you keep a record of what we talked about last week?"* | yes — saved, readable from History, including after a restart |
| audio | *"Is transcription enabled?"* · *"Is there support for speech-to-text?"* · *"Does the microphone work here?"* | no — names `MIGRAPILOT_SPEECH_RUNTIME_URL` |
| images | *"Is vision approved yet?"* · *"Are screenshots supported?"* · *"Is OCR available on this deployment?"* | **not right now** — the gate's own sentence, approval-blocked not absent |
| documents | *"Are PDFs supported?"* · *"What file types do you support?"* · *"What are the limits on the files I can attach?"* | yes — the real supported list |
| web-search | *"Is web search configured?"* · *"Do you have internet access?"* · *"Is browsing the web enabled here?"* | no — *"Web search is not set up yet."* |
| email | *"Is Gmail connected?"* · *"Is your email integration connected?"* | no — *"Email is not set up yet."* |
| code-execution | *"Is code execution enabled?"* · *"Do you have terminal access?"* | no — while explaining, writing and reviewing is yes |
| image-generation | *"Is image generation configured?"* | no — not configured on this server |
| files | *"Do you have access to my local files?"* | yes for the library, explicitly **not** for local paths |

Latency **170–474 ms**, because no model was called.

### Negatives — 6 / 6 reached the model, none hijacked

| asked | ms | answered with |
| --- | --- | --- |
| *"How does computer memory work?"* | 8252 | RAM explanation |
| *"What audio format is best for podcasts?"* | 1132 | MP3 recommendation |
| *"Can you write a Python script to parse this CSV?"* | 7668 | a Python script |
| *"What is the best microphone for recording a podcast?"* | 6117 | microphone recommendations |
| *"Explain memory management in Rust."* | 2006 | Rust ownership |
| *"Tell me about the history of email."* | 1777 | ARPANET history |

The **latency split is itself the evidence**: 1.1–8.2 s through the model versus 0.17–0.47 s
answered from capability state. The two populations do not overlap.

Both phrasings the owner named as required negatives — *"How does computer memory work?"* and
*"What audio format is best for podcasts?"* — remain ordinary knowledge.

---

## Three defects the live run found that the tests did not

All three were found by asking the **deployed product**, after the classifier's own 80 tests
were green. This is the argument for testing the product and not only the module.

### 1. A limits question answered with a feature

*"What are the limits on the files I can attach?"* routed correctly and then answered with the
supported-format list. **True, and not an answer** — limits are one of the six families this
layer owns, and the fact it rendered named no limit.

Fixed in `d90a4e8a`: the numbers come from the attachment authority through the snapshot
(`MAX_FILE_BYTES`, `MAX_FILES`, `MAX_EXTRACT_BYTES`), the same way every other sentence in the
module comes from its authority. Constants copied into this file would be a second opinion
that drifts the first time `MIGRAPILOT_MAX_FILE_MB` changes. Tested both ways: **no limits
supplied means no sentence about limits**, because the fix for a true-but-useless answer must
not become an invented number.

### 2. 🚨 One limit, two numbers

The new sentence said **"26 MB"** while the `file_too_large_to_read` message on the very next
turn said **"25 MB"** — one limit, two surfaces of the same product, two numbers.

The env vars are named `_MB` and `megabytes()` multiplies by 1024×1024, so dividing by
1,000,000 and rounding produced a second answer. It now divides the way the other surface
divides — `Math.floor(bytes / 1_048_576)`, exactly as the route's branch does — and the test
pins the two surfaces **to each other** rather than pinning a literal, so they cannot drift
apart again.

This is the module's own founding defect in miniature: a fact the system holds exactly,
re-derived somewhere else, producing a difference.

### 3. A limits question that reached the model anyway

*"How many files can I keep?"* was answered:

> "You can keep as many files as your device's storage allows. If you're referring to a specific
> context, like a Google Drive account or a Microsoft Office 365 subscription, the limit would
> be according to those services' storage capacity."

Invented, about other vendors' products, when `MAX_FILES` is **2000** and the product knows it.
The classifier had the subject and the facet but no topic, because the topic patterns matched
the feature noun only when a verb came **before** it — and "how many **files** can I **keep**"
is the ordinary word order for a limits question.

Fixed with a frame for *"how many/large/big … can I keep/store/upload/attach/send"* — "can I"
plus a verb only this product performs — and topic patterns that match the noun when the verb
follows it.

The obvious risk is that *"how many X can I keep"* is a question anyone asks about anything, so
the vendor guard grew the storage services it was missing. Nine such questions now sit in the
ordinary corpus permanently:

> *"How many files can I keep in Dropbox?"* · *"How many photos can I store on iCloud?"* ·
> *"How many people can I invite to a Zoom call?"* · *"How much RAM can I install in this
> laptop?"* · *"How many rows can I store in SQLite?"* · *"How long can I keep leftovers in the
> fridge?"* · *"How big can a Docker image be?"* · *"What is the biggest city in Haiti?"* ·
> *"What is the largest number JavaScript can represent?"*

beside the four product limits questions that must always resolve.

---

## The test suite is the acceptance set, not examples

`platformAnswer.test.ts` — **84 tests**:

- the ten originally-measured failures, unchanged
- the two owner-failing phrasings **verbatim**, asserting `confidence: 'high'`, the resolved
  topic, and — for #2 — `subject: 'self-implicit'`, since that is the mechanism under test
- a **paraphrase matrix**: 43 phrasings across nine topics and six question families
- **two corpora**, both directions of the failure:
  - 34 ordinary questions that must never be hijacked — a hijack answers a real question with
    a capability table in the product's own voice, which is worse than the bug being fixed
  - 13 product questions that must always resolve, and must render a verdict
- low confidence returns no topic; "not verified" ≠ "no"; limits present and absent

`npm test`: **1248 / 1248, 0 failures, 0 skipped, 0 todo.** `tsc --noEmit`: clean.

---

## Release chain

```
expected commit  2d1793e9
built artifact   buildId UUOCgvduJcRE8WlIolPTB
boot-tested      identity matched on port 3097
activated        current -> capability-intent-09133
RUNNING PROCESS  reports commit 2d1793e9 / release capability-intent-09133
                 / buildId UUOCgvduJcRE8WlIolPTB
```

Two earlier attempts are part of the record. `capability-intent-09132` **aborted at step 1**
because `docs/migrapilot` was dirty with the evidence edits — the guard working. Its wrapper
still reported exit 0, so the check that caught it was reading `/api/version` and seeing the
**old** release, not the exit code. Proving what is running is the only link that cannot be
faked.

### Production, confirmed untouched after the deploy

```
/opt/migrapilot/consumer/releases/chat-platform-rc-0908
/opt/migrapilot/brain-service/releases/chat-platform-rc-0908
ActiveEnterTimestamp=Fri 2026-09-11 06:31:26 UTC   (consumer)
ActiveEnterTimestamp=Fri 2026-09-11 06:31:26 UTC   (brain)
```

Both symlinks unchanged and **both service start timestamps unbroken since 2026-09-11**.

---

## Final confirmation on `capability-intent-09133`

| | |
| --- | --- |
| capability-owned | **6 / 6** — 178–597 ms |
| reached the model | **4 / 4** — 718–2295 ms |

```
What are the limits on the files I can attach?
  → …Up to 256 MB per file, and text is read from the first 25 MB of it.   [184 ms]
How many files can I keep?
  → …You can keep up to 2,000 files.                                        [250 ms]
How many files can I keep in Dropbox?
  → "Dropbox has a limit of 3 billion files in your account…"               [718 ms, model]
```

**25 MB**, matching the `file_too_large_to_read` message exactly. And the nearly identical
Dropbox phrasing still goes to the model, which is the guard the limits frame needed.

---

## Not accepted

**CAPABILITY SELF-DESCRIPTION P0 — READY FOR OWNER VALIDATION.**
Nothing here is OWNER VERIFIED. Production was not promoted.
