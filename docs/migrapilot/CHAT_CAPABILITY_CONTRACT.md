# MigraPilot Chat — capability contract and gap analysis

**2026-09-14.** Target state first, current state second.

> 🚨 **THE CODE DOES NOT DEFINE THE PRODUCT.** `pptx → refused` is not "MigraPilot does not
> support PowerPoint". It is *PPTX support is missing and is on the backlog*. Every absence below
> is a gap against the target, never a reduction of it.
>
> 🚨 **A weaker model is acceptable and measurable. Missing plumbing is not.** If the model can
> process something and MigraPilot never delivers it the file, loses the conversation, cannot
> invoke the capability, or has an incomplete UI — that is our defect.

## Status vocabulary

| status | meaning |
| --- | --- |
| `USER-PROVEN` | the owner exercised it in the real product |
| `READY FOR USER TEST` | verified automatically; awaiting the owner |
| `IMPL/UNPROVEN` | implemented and traced to a real route; never exercised |
| `PARTIAL` | works for some inputs or some of the way |
| `BROKEN` | implemented and demonstrably wrong |
| `MISSING` | not implemented |
| `BLOCKED BY CAPABILITY` | Chat plumbing reaches the boundary; an approved capability does not exist |

**Nothing below is `USER-PROVEN`.** That status is the owner's to grant and I have not granted it
to anything.

---

## 1. Conversation fundamentals

| target | current | note |
| --- | --- | --- |
| Send, stream, see tokens arrive | `IMPL/UNPROVEN` | SSE token frames |
| Stop generating mid-answer | `IMPL/UNPROVEN` | aborts the request, not just the UI |
| Retry / regenerate | `IMPL/UNPROVEN` | carries a disabled-reason when it cannot |
| Edit and resend | `IMPL/UNPROVEN` | forks a new turn; deliberately not called "Edit" |
| **Copy the answer** | `BROKEN` in production, fixed locally | corrupts code — see §9 |
| Feedback on an answer | `IMPL/UNPROVEN` | persisted; a failed write selects nothing |
| Conversation history, switching | `IMPL/UNPROVEN` | |
| Rename, delete, export | `IMPL/UNPROVEN` | real routes, optimistic with rollback |
| Reload recovery | `IMPL/UNPROVEN` | durable in PostgreSQL; never exercised |
| Long conversations | `UNKNOWN` | never measured |
| Useful errors | `PARTIAL` | typed refusals exist for documents, images, capabilities; coverage elsewhere unaudited |

---

## 2. Files and documents

### Target — what a user should be able to bring

| class | formats | why |
| --- | --- | --- |
| Documents | PDF, DOCX, **PPTX**, ODT/ODP/RTF | the everyday set people actually hold |
| Text & data | TXT, MD, CSV, TSV, XLSX, **XLS**, JSON, XML, YAML | notes, exports, spreadsheets |
| Code & config | the common languages, dotfiles, logs | "find the problem in this code" |
| Images | PNG, JPG, WEBP, GIF, **HEIC**, screenshots, photos of documents | |
| **Scanned PDFs** | image-only, via OCR | a contract scanned to PDF is the normal case, not the exotic one |
| **Audio** | MP3, WAV, M4A, OGG | "transcribe this call" |
| **Archives** | ZIP | "review this project" — judgement call, see below |

### Target — what a user should be able to *say*

"Summarize this." · "What does page 7 say?" · "Compare these two files." · "Find the problem in
this code." · "Calculate the totals in this spreadsheet." · "What changed between these
versions?" · "Read the contract, find the cancellation clause, tell me the page, and compare it
with the payment terms."

### Current

| capability | status | evidence / gap |
| --- | --- | --- |
| Attach any file through the composer | `IMPL/UNPROVEN` | a general picker (`multiple`, unrestricted) plus a Photos filter over the same handler |
| PDF with a text layer — read, cited | `PARTIAL` | proven **via the API with an explicit index call**, answered with a citation. Never through the composer |
| PDF, page-specific questions | `UNKNOWN` | page provenance exists in the extractor; never asked |
| PDF with tables | `UNKNOWN` | |
| **Scanned / image-only PDF** | `BLOCKED BY CAPABILITY` | plumbing proven to the boundary — see §9 |
| DOCX | `IMPL/UNPROVEN` | `docxText.ts` exists; never exercised through Chat |
| TXT / MD / JSON / XML / YAML / code | `IMPL/UNPROVEN` | indexed |
| CSV / TSV / XLSX | `PARTIAL` | structured analysis only — tables, columns, totals. Prose inside a workbook is **not** searchable, and the product says so |
| **PPTX** | `MISSING` | refused with a reason. **Backlog, not a product limit** |
| **Legacy office** (DOC, XLS, PPT, ODT, ODP, RTF) | `MISSING` | refused with a reason. Backlog |
| **ZIP** | `MISSING` | refused. Judgement: lower value than PPTX, and a security surface — recommend deferring |
| **Audio attachments** | `MISSING` | no audio entries at all in the matrix. Backlog |
| Multiple attachments in one turn | `UNKNOWN` | the picker is `multiple`; the turn carries an array. Never tested |
| Cross-file comparison | `UNKNOWN` | |
| Provenance / file association after reload | `UNKNOWN` | immutable per-turn record exists by design |

---

## 3. Multimodal

| target | current | |
| --- | --- | --- |
| Text | `IMPL/UNPROVEN` | |
| Images attached, viewed, dragged out | `IMPL/UNPROVEN` | tray, lightbox, content-addressed refs |
| **Image understanding** | `BLOCKED BY CAPABILITY` | see §9 |
| Documents | see §2 | |
| **Microphone / speech-to-text** | `BLOCKED BY CAPABILITY` | see §9 |
| **Audio file transcription** | `MISSING` | no pipeline; distinct from the microphone gap |
| Image generation | `BLOCKED BY CAPABILITY` | typed refusal `image_generation_not_configured` |
| Mixed text + attachments in one prompt | `UNKNOWN` | |

---

## 4. Contextual reference resolution

**Target:** "this file", "the table above", "what I said earlier", "compare that with the first
document" must resolve. Switching away and back must not destroy working context.

**Current: `UNKNOWN` — entirely.** Conversation history is durable and grounding is reconciled
per turn, so the mechanism exists. No reference-resolution behaviour has been exercised. This is
the least-evidenced area of the whole product and, for a chat assistant, one of the most
load-bearing.

---

## 5. Assistant tasks

Writing, rewriting, summarisation, translation, explanation, brainstorming, analysis, coding
help, document Q&A, structured-data analysis, multi-step assistance.

**Current: `IMPL/UNPROVEN`.** These are ordinary model turns over the existing path. The Phase 2
campaign measured reasoning quality in isolation, which — per the boundary correction — is not
Chat acceptance. None has been exercised *as a user task in the product*.

---

## 6. Tools and capabilities

**Target:** once Brain has an approved capability, Chat can use it through the governed interface
— no second hard-coded implementation per feature.

| capability | current |
| --- | --- |
| Capability registry consulted per turn | `IMPL/UNPROVEN` — `listCapabilities({principal})`, per-principal |
| Web search | `BLOCKED BY CAPABILITY` — registered, not configured |
| Email | `BLOCKED BY CAPABILITY` — registered, not configured |
| Code execution | `BLOCKED BY CAPABILITY` — registered, deliberately not enabled in chat |
| File library | `IMPL/UNPROVEN` |
| Project knowledge | `MISSING` — no project-binding repository; the Brain refuses to serve it from memory |
| Truthful exposure of an unavailable capability | `IMPL/UNPROVEN` locally, **absent in production** |

---

## 7. Persistence

| target | current |
| --- | --- |
| Conversations survive reload and browser close | `IMPL/UNPROVEN` |
| Attachments stay associated with their turn | `IMPL/UNPROVEN` — immutable per-turn record |
| Working context survives switching away and back | `UNKNOWN` — never run |
| Generated artefacts persist | `PARTIAL` — generated images are content-addressed refs; generation itself is blocked |

---

## 8. Production parity

**`BROKEN` as a process.** Production runs `0f494d27`; local is **20 consumer commits** ahead,
including three truthfulness fixes and one data-corrupting bug. The target is that the version
validated locally becomes the exact version in production.

---

## 9. `BLOCKED BY CAPABILITY` — plumbing evidence to the boundary

Each of these requires proof that **our** side works right up to the missing capability. Without
that, "blocked" is an excuse rather than a diagnosis.

| blocked item | plumbing evidence |
| --- | --- |
| **Scanned PDF** | file accepted and stored; extraction attempted; the reader reports `reader_unavailable` with its own sentence; the chat path renders `document_reader_unavailable` — *"the page renderer is not available on this server. Nothing is wrong with your file."* **Measured end to end on staging.** The only missing piece is the renderer binary. |
| **Image understanding** | image accepted, stored, content-addressed, rendered, re-attachable; the vision gate returns its own verdict; the capability answer reports `not right now` with the gate's sentence. Missing piece: an approved vision model (production **has** one — `qwen2.5vl:7b`). |
| **Microphone** | control present and correctly disabled, naming `MIGRAPILOT_SPEECH_RUNTIME_URL`. Missing piece: a speech runtime. |
| **Image generation** | request reaches the Brain, refusal returns as a typed SSE frame, consumer maps it to `image_generation_not_configured`. Missing piece: a generation provider. |
| **Web search / email** | registered in the capability registry, reported unavailable with the engine's own sentence. Missing piece: configuration. |

Every one of these is plumbing-complete to the boundary. **None is blocked by our implementation.**

---

## 10. Work order

1. **Conversation UX** — close the `UNKNOWN`s: reload recovery, long conversations, scroll,
   error coverage. Then owner test.
2. **Attachments through the real composer** — PDF first (multi-page, tables, page-specific,
   follow-ups), then DOCX, then XLSX, then multiple files and cross-file comparison.
3. **Context and persistence** — the reference-resolution scenarios in §4, and the
   switch-away/return/reload cycle.
4. **Assistant workflows** — the ordinary tasks in §5, as user tasks.
5. **Capability integration** — that an approved capability becomes usable in Chat without a
   bespoke implementation.
6. **Production promotion**, then owner validation on production.

**Backlog, in my recommended order:** PPTX (highest user value of the refused set) → audio
attachments → scanned-PDF OCR (a renderer/OCR install, not a code change) → richer spreadsheet
prose → legacy office → HEIC → ZIP (lowest value, largest security surface).

Model qualification and training stay outside this gate unless an end-to-end Chat test shows the
model is the blocking layer — which requires first proving the information reached it intact.
