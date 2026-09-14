# MigraPilot Chat — module census

**2026-09-14.** One grounded inventory of the actual Chat surface.

> 🚨 **Nothing in this document is marked "user-proven". I cannot mark anything user-proven.**
> Automated verification reaches **READY FOR LOCAL USER TEST** and no further. Every row below
> is either *implemented* (traced to working code and a real route) or *not implemented* — the
> owner's own testing is what moves a row to accepted.

## Status vocabulary

| status | meaning |
| --- | --- |
| `IMPL` | implemented, traced to a real route, **not user-proven** |
| `BROKEN` | implemented and demonstrably wrong |
| `MISSING` | not implemented |
| `UNKNOWN` | cannot be determined without running the real product |
| `PROD` | present in the deployed production build (`0f494d27` / `chat-platform-rc-0908`) |
| `LOCAL` | exists only in the local branch — **not in production** |

---

## 🚨 Production lag

Production runs **`0f494d27`**. Local HEAD is **`a42f574b`** — **20 commits** ahead on the
consumer alone.

Verified absent from production, present locally:

| module | production |
| --- | --- |
| `features/capabilities/platformAnswer.ts` (capability-owned answers) | **ABSENT** |
| `features/attachments/readFailure.ts` (truthful document failures) | **ABSENT** |
| `features/chat/messageText.ts` (copy correction) | **ABSENT** |
| `engine/rag/documentReaderCapability.ts` (runtime-aware PDF capability) | **ABSENT** |

**Everything this programme has fixed for a week is local.** The public system still answers
capability questions from the model, still says "No readable content was found" for a renderer
failure, and still corrupts code on copy.

---

## 1. Core conversation UX

| feature | status | evidence |
| --- | --- | --- |
| New chat | `IMPL` `PROD` | route + sidebar control |
| Conversation list / history | `IMPL` `PROD` | `listConversations` |
| Switch conversation | `IMPL` `PROD` | `/chat/[id]` |
| Rename | `IMPL` `PROD` | `renameConversation`, optimistic with rollback |
| Delete | `IMPL` `PROD` | `deleteConversation`, confirmed first |
| Export transcript | `IMPL` `PROD` | built from what is on screen |
| Send message | `IMPL` `PROD` | `/api/chat/stream` |
| Streaming tokens | `IMPL` `PROD` | SSE `token` frames |
| **Stop generating** | `IMPL` `PROD` | `aria-label="Stop generating"`, aborts the request |
| Edit and ask again | `IMPL` `PROD` | deliberately **not** called "Edit" — it forks a new turn rather than rewriting history |
| **Copy answer** | `IMPL` `LOCAL` | ⚠️ **was `BROKEN` in production** — see below |
| Response feedback | `IMPL` `PROD` | persisted; a failed write leaves nothing selected |
| Try again / retry | `IMPL` `PROD` | with a disabled-reason when it cannot |
| Speak answer | `IMPL` `PROD` | `SpeakButton` |
| Reload restoration | `UNKNOWN` | durable in PostgreSQL; **not proven by me through the UI** |
| Long-conversation behaviour | `UNKNOWN` | never measured |
| Scroll behaviour | `UNKNOWN` | never measured |

### 🚨 Copy is broken in production

Production strips every `**` from the whole answer, and a streamed turn is one block holding the
entire response — code fences included:

```
on screen                       on the clipboard
def f(*args, **kwargs):    →    def f(*args, kwargs):
    return 2 ** 8                   return 2  8
```

Fixed locally, verbatim, with success/failure confirmation. **Not in production.**

---

## 2. Attachment pipeline — the supported-file matrix

Read from the canonical `ATTACHMENT_TYPES` table, not from prose.

| group | extensions | support |
| --- | --- | --- |
| **Indexed** (text extracted, searchable, citable) | `pdf` `docx` `txt` `md` `markdown` `log` `csv` `tsv` `json` `xml` `yaml` `yml` `toml` `ini` `conf` + 20 code types | `indexed` |
| **Images** | `png` `jpg` `jpeg` `gif` `webp` | `indexed` |
| **Structured only** (tables analysed, prose not searchable) | `csv` `tsv` `xlsx` | `structured` |
| **Refused with a reason** | `doc` `odt` `rtf` `xls` `ods` `ppt` `pptx` `odp` `zip` `tar` `gz` `sql` | `unsupported` |

**Extractors confirmed to exist:** PDF (`unpdf`, text-layer), DOCX (`docxText.ts`), plain text,
and the structured table layer.

### 🚨 There is no audio attachment pipeline at all

`ATTACHMENT_TYPES` contains **zero** audio entries. No `mp3`, `wav`, `m4a`, `ogg`. Audio cannot
be attached, and the matrix is honest about that rather than accepting a file nothing will read.

The composer's **microphone** is a different thing — speech-to-text input, and it is
**not configured** on any deployment (`MIGRAPILOT_SPEECH_RUNTIME_URL` unset). The control is
correctly disabled and says so.

### 🚨 What is NOT proven about attachments

| claim | status |
| --- | --- |
| a normal PDF uploads, is read, and can be asked about | **UNKNOWN** — never done through the real UI |
| page-specific questions on a multi-page PDF | **UNKNOWN** |
| a PDF containing tables | **UNKNOWN** |
| mixed text + image PDF | **UNKNOWN** |
| DOCX end to end | **UNKNOWN** — extractor exists, never exercised through Chat |
| XLSX totals/columns/sheets | **UNKNOWN** |
| document context surviving conversation switches | **UNKNOWN** |
| multiple attachments in one turn | **UNKNOWN** |
| image understanding | `MISSING` in practice — governance-blocked, no approved vision model on staging |

What I *have* proven is narrower and should not be mistaken for the above: a **text-layer PDF**
uploaded via the API was indexed and answered with a citation, and a **scanned PDF** produced a
truthful `document_reader_unavailable`. That was the API path with an explicit index call — not
a user selecting a file in the composer.

---

## 3. Multimodal

| capability | status |
| --- | --- |
| Text chat | `IMPL` `PROD` |
| Document understanding | `IMPL` — end-to-end through the UI `UNKNOWN` |
| Image attachment + viewing | `IMPL` `PROD` — upload, tray, lightbox, drag-out |
| Image **understanding** | governance-blocked; no approved vision model on staging (production has `qwen2.5vl:7b` approved) |
| Microphone / speech-to-text | `IMPL`, **not configured anywhere** — correctly disabled |
| Audio attachments | `MISSING` by design |
| Multiple attachments in one turn | `UNKNOWN` |
| Mixed text + attachment prompt | `UNKNOWN` |

---

## 4. Persistence and context — entirely unproven

The owner's scenario — upload a PDF → discuss → leave to Chat B → return to Chat A → ask again
→ reload → ask again — **has never been run**. Conversations and grounding are durable in
PostgreSQL and `appendMessage` is awaited before the turn advances, so the mechanism exists.
**Mechanism existing is not the product working.**

---

## 5. Promotion gate

```
implemented locally / candidate
  → automated verification  → READY FOR LOCAL USER TEST
  → owner tests locally     → LOCALLY ACCEPTED
  → promoted and deployed   → (deployed)
  → owner tests production  → PRODUCTION ACCEPTED
```

**Every Chat row above is at most READY FOR LOCAL USER TEST.** Nothing is locally accepted,
nothing is production accepted, and the four modules listed at the top are not even deployed.

---

## What I would do next, in order

1. **Owner-testable local build** of the core conversation UX, so the `UNKNOWN` rows above
   (reload restoration, scroll, long conversations) become answerable.
2. **Attachment acceptance through the real composer**, one type at a time, PDF first — a
   multi-page PDF with tables, asked page-specific questions, then followed up, then switched
   away from and returned to, then reloaded.
3. **Decide the production-lag question.** Twenty consumer commits, including three
   truthfulness fixes and a copy corruption, sit undeployed. That is a separate owner decision
   from finishing the module.

Knowledge ingestion and model qualification stay outside this gate.
