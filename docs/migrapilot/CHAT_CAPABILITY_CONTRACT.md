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
| Conversation history, switching | `READY FOR USER TEST` | History is its own page, not a sidebar list — by design. Switch away and back keeps the thread and its grounding |
| Rename, delete, export | `IMPL/UNPROVEN` | real routes, optimistic with rollback |
| Reload recovery | `READY FOR USER TEST` | five turns, attachment chips and the grounding tray all restored from PostgreSQL — §11 |
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
| PDF with a text layer — read, cited | `READY FOR USER TEST` | the full slice ran **through the real composer** on staging — see §11 |
| PDF, page-specific questions | `READY FOR USER TEST` | "what does page 4 say about cancellation" → *not less than 90 days*, cited |
| PDF with tables | `READY FOR USER TEST` | Leeds-Glasgow £4580.00 and the £15388.75 aggregate, read out of the rate table |
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

**Current: `READY FOR USER TEST` for documents.** Exercised on staging, in one conversation, in
this order: *"Does that table cover the Cardiff lane? And what payment window does this document
give?"* resolved both — £1743.75 and the 45-day window — then the conversation was switched away
from, returned to, and asked *"You mentioned a service credit earlier — what percentage is it,
and who is the escalation contact?"*, which needed **4 percent** and **Regional Operations
Manager**: two facts that appear nowhere in the transcript, so they had to come from the document
rather than from conversation history. After a reload, a cross-page question answered from page 1
and page 5 together.

Switching to another conversation showed **no leakage** — no grounding tray, no file, none of the
first conversation's figures. What remains `UNKNOWN` here is everything not document-shaped:
"what I said earlier" about prose, and cross-file comparison.

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

### 🚨 Correction: "none is blocked by our implementation" was too strong

That sentence, as first written, let a truthful refusal stand in for a delivered feature. It is
not true that nothing on our side is missing. A renderer binary our deployment does not install,
a speech runtime nobody configured, a generation provider with no credentials — these are
**product and deployment integration gaps on our side**, even though the code detects and reports
them correctly.

Two statuses, because the cases differ:

| status | meaning |
| --- | --- |
| `PLUMBING VERIFIED / CAPABILITY NOT DEPLOYED` | our code path is complete and measured to the boundary; the capability exists but is not installed or configured **here** |
| `INTEGRATION INCOMPLETE` | our side has work left beyond configuration — a pipeline, a format, a wiring step |

| blocked item | corrected status |
| --- | --- |
| Scanned PDF / OCR | `PLUMBING VERIFIED / CAPABILITY NOT DEPLOYED` — install `pdftoppm`, `pdfinfo`, `tesseract` |
| **Every OTHER PDF, on a host with no poppler** | was `INTEGRATION INCOMPLETE`, **fixed** — see §12 |
| Image understanding | `PLUMBING VERIFIED / CAPABILITY NOT DEPLOYED` — approve a vision model on staging; production already has one |
| Microphone / speech-to-text | `PLUMBING VERIFIED / CAPABILITY NOT DEPLOYED` — provide a speech runtime |
| Image generation | `PLUMBING VERIFIED / CAPABILITY NOT DEPLOYED` — configure a provider |
| Web search / email | `PLUMBING VERIFIED / CAPABILITY NOT DEPLOYED` — configure; Gmail additionally needs an HTTPS origin and a redirect URI |
| **Audio attachments** | `INTEGRATION INCOMPLETE` — there is no audio pipeline at all. Nothing to configure; a format and a route must be built |

What remains true, and is the useful half: **none of these is a chat-routing defect.** The turn
reaches the boundary and reports honestly. That is a statement about where the gap is, not a
claim that there is no gap — and "the refusal is truthful" is never acceptance of the feature.

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

---

## 11. The PDF acceptance slice, through the real composer

Staging `readercap-09135`, signed in, five-page digital contract uploaded **through the Action
Hub**, not the API. Every step passed:

| step | result |
| --- | --- |
| Upload via the composer | stored, 5066 bytes, chip *"Ready — MigraPilot can read this · 5 KB"* |
| Summary | correct, cited `pages 1-5` |
| Page-specific — cancellation | *"not less than 90 days written notice"*, page 4 |
| Table | **£4580.00** Leeds-Glasgow and **£15388.75** aggregate |
| Deictic — *"that table"*, *"this document"* | Cardiff **£1743.75**, 45-day payment window |
| Switch away to another conversation | no grounding tray, no file, no figures — clean isolation |
| Switch back | full thread and grounding tray restored |
| Follow-up needing NEW facts | **4 percent** credit, **Regional Operations Manager** — neither in the transcript |
| Reload | all five turns, attachment chips and grounding tray restored from PostgreSQL |
| Continue after reload | initial term **24 months** (page 1) + suspension **60 days unpaid, 10 days notice** (page 5) |

Also observed working: the Action Hub disables Photos & images, Search the web and Email each
with its own authority's sentence, and Dictate names `MIGRAPILOT_SPEECH_RUNTIME_URL`.

🚨 **This is `READY FOR LOCAL USER TEST`, not user-proven.** An automated browser completing the
scenario is not the owner using the product.

---

## 12. The defect the slice found: a readable PDF reported unreadable

**`/api/files` said `reader_unavailable`, `readable: false`, *"This document could not be read:
the page renderer is not available on this server"* — about the very document chat had just
answered six questions from.**

Three layers, captured before anything changed:

| layer | state |
| --- | --- |
| file state | `reader_unavailable`, `readable: false` |
| index / retrieval | indexed and retrieved; answers drew on pages 1-5 |
| answer state | all correct, cited `meridian-agreement.pdf` |

### Cause

Staging has **no poppler at all** (`pdfinfo`, `pdftotext`, `pdftoppm`, `tesseract` all absent —
measured, not assumed). `probePdfTextLayer` calls `pdfPageCount` → `pdfinfo` as its **first**
step, so it threw before the document's content was examined. The runner's
`.catch(() => null)` then made "I could not tell" indistinguishable from "there is no text
layer", the document fell through to the scanned pipeline, and that failed on the missing
rasteriser — producing a verdict about **the user's file** from the absence of a binary.

The capability module had already written this down — *"`pdfinfo` … is not merely a page counter;
it is the gate in front of the whole escalation route"* — but as a caveat, not a fix. Meanwhile it
reported `pdf_text_extraction: available` on the grounds that it is in-process, which was true of
`pdfText.ts` and **not** of the job pipeline that actually ran.

### Fix

`pdfTextLayer.ts` now falls back to the in-process reader (`unpdf`, already a dependency) when —
and only when — the poppler binary is **missing**. The module's contract is reading a PDF that
already carries its text; it now honours that wherever the service runs, which is what
`documentReaderCapability` has always claimed.

Bounded and honest about its limits:

- a poppler that **ran and failed** is telling us about the document, and is never overruled
- a genuine scan still reports `hasTextLayer: false` and escalates to OCR **deliberately**, rather
  than by its caller swallowing an error
- above the same ceiling the synchronous extractor uses, the **original** poppler error is
  rethrown — there, `reader_unavailable` is simply true

### Measured, before and after, on the real `DocumentJobRunner` with poppler removed

| | state sequence | pages indexed |
| --- | --- | ---: |
| before | `queued → matching_known_source → rendering_pages → reader_unavailable` | 0 |
| after | `queued → matching_known_source → reading_text ×6 → indexing → ready` | 5 |

The "before" run reproduces staging's live sentence exactly.

### Still the owner's call, and NOT fixed by this

Installing `pdftoppm` / `pdfinfo` / `tesseract` is what unlocks **scanned** PDFs and OCR. This fix
deliberately does not substitute for that: it stops a *text-layer* PDF being blamed on a renderer
it never needed.

---

## 13. Re-run from the beginning, on the fixed release

`pdftextfallback-0914` / commit `8704b715`. The file was **deleted through the Files UI** and
re-uploaded **through the Action Hub composer**, so the whole slice ran again from nothing.

**Boundary 1, the layer that was lying, now tells the truth:**

| | `/api/files` |
| --- | --- |
| before | `reader_unavailable`, `readable: false`, *"This document could not be read…"* |
| after | `ready`, `readable: true`, *"Ready."* |

The composer chip and the Files API now **agree**. Previously the chip said readable and the API
said the opposite about the same file.

Every step passed again: summary · rate table (£4580.00, £15388.75) · deictic *"that table"* /
*"this document"* · switch away and back · reload · continue with facts absent from the transcript
(4% service credit, Regional Operations Manager).

### Two model-layer misses, and why they are not ours

| turn | answer | truth |
| --- | --- | --- |
| *"What does page 4 say about cancellation? Give the notice period."* | *"No specific notice period is mentioned…"* | *"not less than **ninety** days written notice"* |
| service credit | attributed the trigger to the 96.5% target | the credit triggers **below 94 percent** |

🚨 **The first was proven to be the model, not the plumbing, before it was called that.** Asked to
*quote* the sentence, the model reproduced it verbatim — so the text was in the retrieved context
the whole time; it simply failed to turn a spelled-out number into an answer. The summary turn
had already got "90 days" right, so this is **inconsistency, not incapacity**.

This is the lane boundary working as written: *"Model qualification stays outside this gate unless
an end-to-end Chat test shows the model is the blocking layer — which requires first proving the
information reached it intact."* That proof was obtained. These two go to **MigraAI Engineer**,
not to Chat acceptance.

**Still `READY FOR LOCAL USER TEST`.** The automated browser completing the scenario twice is not
the owner using the product.

---

## 14. DOCX through the real composer — PASSED, no defects

`northwind-maintenance.docx`, built to exercise every structural path the
extractor has a past defect in, and validated against the product's own
extractor before use.

| step | result |
| --- | --- |
| Upload via the composer | stored; **no processing record** — correct: a DOCX is read inside the request |
| Summary + list | three sites as a real list; picked up the **footnote** (consumables at cost plus 8%) |
| Table | Brixham **£3663.00**, total **£12452.00** — and it chose the *annual cost* column, not unit cost |
| Deictic *"that table"* + text box | "the table does not include it … **£185.00** per visit" — from the **text box**, the part that used to be dropped entirely |
| Switch away | zero leakage into the other conversation |
| Reload | all three turns and the grounding tray restored |
| Continue after reload | **NW-MAINT-2026-14**, cited *"in the footer"*, plus the four-hour escalation to the Duty Engineer |

Every structural path held: table row relationships, text boxes, footnotes,
footers, lists, headings. One garbled sentence in the middle of an otherwise
correct answer — model expression, not plumbing.

---

## 15. XLSX through the real composer — TWO REAL DEFECTS, both ours, both fixed

`regional-sales-2026.xlsx`: three sheets (Q1 Sales, Q2 Sales, Targets), formulas
with cached totals, and a totals row on each sales sheet.

### 🚨 Defect 1 — a fabricated financial figure

> *"On the Q1 Sales sheet, what revenue is listed for East?"* →
> **"Revenue for East on the Q1 Sales sheet is $54,212."**

The sheet says **25443.75**. The number was invented, in a currency the file
does not use, stated flatly with no caveat, about a file whose chip was on
screen. **There is no worse failure available to this product.**

**Cause, and it was ours.** The truthful refusal for this case already existed
and was *unreachable*. The structured-only branch was gated on
`asksOfDocument`, which answers a different question — "the user asks about a
document and NONE is attached" — and infers from vocabulary because in that case
there is no file to look at. Its noun list carries `spreadsheet` and `csv` but
not `workbook`, `sheet` or `xlsx`, so for an attached workbook it returned false
for **every** spreadsheet question, "Summarize this workbook" included. The
branch never fired and the turn reached the model with no evidence at all.

**Fix:** not more nouns. With a file actually attached, whether the turn concerns
it is not something the prompt's vocabulary gets to decide — the user attached
it. Only the craft escape hatch survives, which is about the question rather
than the file.

### 🚨 Defect 2 — the author's own total, summed again

> *"Use the Q1 Sales sheet. What is the total revenue across the four regions?"* →
> **"$151,427.50"**

The four regions total **75,713.75**. The sheet's own `Total` row was summed as
if it were a fifth region. Exactly double. Produced by the **deterministic table
layer**, not the model — no amount of model work would have touched it — and
disclosed nowhere. On less round numbers nobody would ever catch it. Most real
business sheets end in a totals row, so this was close to the default case.

**Fix:** a row whose label *is* a totals word is a summary, not an observation.
Detected from what the author wrote, never inferred from the arithmetic —
"Total" is a summary row, "Total Systems Ltd" is a supplier. Excluded from every
operation, because the maximum of a column containing its own total is always
the total. And **disclosed**, because the user is looking at a total printed in
their own sheet: a figure that differs from it must say why.

### After both fixes, re-run from nothing

| question | answer |
| --- | --- |
| total revenue, Q1 | **$75,713.75** + both disclosures |
| highest revenue, Q1 | **East, $25,443.75** — totals row excluded from max |
| total revenue, Q2, after reload | **$78,465** |
| the lookup that fabricated | truthful refusal naming the file and what it can do |
| switch away / reload | no leakage; thread, figures and disclosures restored |

### Gaps found, which are NOT defects — they fail honestly

| gap | behaviour |
| --- | --- |
| **Row lookup** — "what revenue is listed for East" | the table layer recognises totals, averages, min/max, counts and summaries, but not a row lookup. Refuses truthfully rather than guessing |
| **Deictic sheet reference** — "on that same sheet" | sheet selection reads the current prompt only, not the conversation. Asks which sheet; does not pick one |

Both belong in the backlog under contextual reference resolution. Neither
produces a wrong answer.

---

## 16. Still explicitly open

**Scanned PDF / OCR is NOT closed by any of this.** The text-layer fix in §12
stops a readable PDF being blamed on a renderer it never needed; it does nothing
for a PDF that genuinely needs rasterising and OCR. `pdftoppm`, `pdfinfo` and
`tesseract` are still absent from staging, `pdf_page_rendering` and `pdf_ocr`
still report `unavailable`, and that capability must be deployed and then tested
**as its own slice**.

### Backlog order, after DOCX and XLSX

multiple attachments → contextual references across files → image + document
combinations → conversation persistence edge cases → remaining message controls
→ audio attachment pipeline → scanned PDF/OCR → production promotion →
production user validation.
