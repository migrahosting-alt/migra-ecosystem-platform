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

---

## 17. Row lookup — SHIPPED, the first item taken off the "can't do that" list

`rowlookup-0915` / commit `7ec050c1`. The gap recorded in §15 is closed.

| question | before | now |
| --- | --- | --- |
| *"On the Q1 Sales sheet, what revenue is listed for East?"* | **"$54,212"** (fabricated), then a truthful refusal | **$25,443.75** ✓ |
| *"How many units for West on the Q1 Sales sheet?"* | counted rows | **640** ✓ |

**The row is identified from the FILE, not the phrasing** — the prompt names a
value that appears in a label column. So "what revenue is listed for East",
"East revenue?" and "how much did East do" all resolve by one mechanism, and a
prompt naming no row still produces nothing. The gate that reaches this path is
deliberately weak (any "what…", or anything ending in "?") precisely because the
gate decides nothing; the file does. *"What is the capital of France?"* trips the
same gate and comes back empty.

The whole row is handed over, cell by cell, exactly as stored — choosing one
column on the user's behalf is the ambiguity this module refuses everywhere else.

**Three guards, each paid for by an earlier failure:** a totals row is never a
lookup target · labels under three characters are skipped · a label on more than
one row is reported as ambiguity rather than resolved by picking the first.
`isTotalsLabel` is now **one** definition, owned by the arithmetic layer, rather
than a second private copy — the drift this codebase has been bitten by before.

**Two collisions found by running it, not reading it:** `"How many units for
West?"` resolved to `count` (a question about how many *rows* exist — naming one
row contradicts that), and `"What is the capital of France?"` injected *"MigraPilot
could not calculate this from regional-sales-2026.xlsx"* into a turn that was
never about the file.

### Still open, re-confirmed live

**Deictic sheet reference.** *"How many units for West on that sheet?"* still
answers *"the question doesn't specify which sheet"*. Sheet selection reads the
current prompt only, not the conversation. It fails honestly and remains on the
backlog under contextual reference resolution.

**Scanned PDF / OCR.** Unchanged and still the biggest gap — see §16. Measured
today on `liv_kreyol_AI-Training.pdf`: Producer `EPSON Scan`, 245 pages, **zero
extractable characters on every page sampled**, and `unpdf` agrees
(`no_text_layer`). Poppler alone cannot help it — there is no text to extract.
It needs `pdftoppm` **and** `tesseract`, and the install is the owner's call.

---

## 18. Multiple attachments and cross-file reasoning

Pair: `meridian-agreement.pdf` (5-page freight contract) + a purpose-built
`meridian-rate-review-2026.xlsx`, designed so the two **disagree on three
values** — payment terms 45 vs 30 days, Leeds-Glasgow 4,580.00 vs 4,880.00,
aggregate 15,388.75 vs 15,688.75 — with one fact present only in the workbook.
Both attached in a single picker action.

### 🚨 Defect 1 — a workbook attached beside a document contributed nothing

> *"Compare the payment terms in these two files."* → *"...payable within
> forty-five days... **No payment terms are mentioned in the provided excerpts
> from the other file.**"*

The workbook's Terms sheet reads `Payment terms | 30`. The trace showed
`grounding_active: 2` and **no table evidence at all**: both files active, one
contributing nothing, and the model invited to characterise a file it had never
seen. The user reads that as "the spreadsheet does not mention payment terms" —
false about their own file, and the disagreement was the whole point of asking.

**Cause:** a workbook only ever reached the model through the COMPUTED path,
which fires on a recognised aggregate. "Compare" is not one. Neither is
"differences", "contradict" or "which is higher" — the entire cross-file class
was invisible.

**Fix:** showing a document is not calculating with it. Computed evidence stays
gated on an operation (the model must never derive a total); **content** evidence
— the sheet as written — is supplied for any workbook the computed path did not
already speak for. Bounded at 20,000 cells with the truncation caveat carried in
the evidence.

### 🚨 Defect 2 — a pair attached together was split on the next turn

| turn | reason | active | withheld |
| --- | --- | ---: | ---: |
| 1 | `attached_this_turn` | 2 | 0 |
| 2 | `conversation_default` | **1** | **1** |

The follow-up silently dropped one file, then reported it as not mentioning a
figure printed on its page 3.

**Cause:** the rule kept the last name in a **flat list**. Right for what it was
written for — a thread that *accumulated* unrelated documents, where reactivating
everything made a new question cite an old scan. Never right for a set attached
in one action, and a flat list cannot tell those apart.

**Fix:** the boundary is the attachment **event**. Two files chosen in one picker
action land **137 ms apart** (measured); the window is 120 s so a slow multi-file
upload still counts as one action. Proven both ways — the pair survives, and a
scan from an hour earlier still stays out.

### 🚨 Defect 3 — asserting a limit we no longer have

The route appends a capability sentence to every spreadsheet turn. After Defect 1
was fixed, an answer quoted a payment term **out of the workbook's cells** and
then closed with *"general document-style text search inside spreadsheets is not
available yet"* — contradicted by the sentence above it. Exactly what
`spreadsheetDisclosure` exists to prevent, from the other direction. The
disclosure now states what the turn actually did.

### After the fixes — provenance is per-file

| question | result |
| --- | --- |
| Compare payment terms | **45 days (pdf)** vs **30 days (xlsx)**, each named; both cited |
| Higher aggregate | £15,688.75 from the workbook, both files cited, `active 2 / withheld 0` |
| *"What is the total?"* (ambiguous) | **asked which sheet** — did not silently pick |
| Summarize differences | £15,388.75 → the PDF (with line provenance), £15,688.75 → the workbook's "Monthly GBP" column |
| switch away → reload → *"Going back to those two files, which one had the 45-day term?"* | **"The Meridian Agreement PDF had the 45-day term... the Excel file mentioned 30 days."** Both cited |

Citations distinguish the two correctly: `meridian-agreement.pdf · pages 2-5`
carries pages, the workbook does not — because a workbook has no pages.

### One model-layer miss, proven before it was called that

The comparison turn said the PDF *"does not directly state a specific monthly
charge"*. Asked to quote it, the model produced **"Aggregate monthly charge
across all lanes: 15388.75 GBP."** verbatim — so the text was in the retrieved
context the whole time. Same shape as the "ninety days" miss: the information
reached the model intact and the model failed to use it on a comparison. Goes to
**MigraAI Engineer**.

### Not covered by this slice — stated plainly

- **Two similarly named files** — not run.
- **A genuine cross-file calculation** — the artifacts do not force one: the
  workbook carries both pallets and rates, so it is self-sufficient. That is a
  gap in the TEST, not a finding about the product, and needs an artifact pair
  where neither file alone suffices.
- ~~**Empty list items**~~ — **WITHDRAWN, this was my own measurement error.**
  The bullets were not empty: my evidence grep filtered the snapshot to
  `paragraph`/`listitem`/`link` nodes and hid their `strong` and `text`
  children. The answer actually read *"**Aggregate monthly charge**: The figure
  in the Meridian Agreement PDF is £15,388.75, while the figure in the Meridian
  Rate Review 2026 Excel file is £15,688.75"* and the same shape for the payment
  term — a correct bulleted comparison with both figures attributed. Rendering
  is fine. The lesson is the one this programme keeps relearning: a reading
  taken through my own instrument is a claim about the instrument until it is
  checked against the raw evidence.

---

## 19. Contextual references — ordinals

### 🚨 Defect — "the first document" resolved to nothing

> *"What does the first document say about cancellation?"* →
> **"The first document doesn't say anything about cancellation."**

That contract's page 4 is headed *"Page 4 - Cancellation"*, and the citation on
that same answer read `meridian-agreement.pdf · pages 2-5`.

**Discriminated before it was diagnosed:** asking again with the **file named**
answered correctly. Nothing was missing from the evidence — chunks arrive
labelled with a filename and content evidence names its workbook — but nothing
anywhere stated the ORDER the files were provided in, so an ordinal had nothing
to resolve against.

**Fix: stated, not inferred.** Resolving "first" ourselves and rewriting the
prompt would put a guess where a boundary belongs, which is what `turnGrounding`
already refuses. Order is something the product knows — upload time, from the
same listing that decides availability — so it is stated as a fact and the model
resolves the reference as a reader would. Nothing is emitted for a single
attachment. A file with no timestamp keeps its given position: an unknown time
is not a claim that it came first.

### Verified live on `ordinals-0915`

| reference | result |
| --- | --- |
| *"the first document"* | the PDF — **90 days' notice**, plus the three-consecutive-months clause |
| *"Now compare that with the second file."* | *"The **first file**... 90 days... The **second file**, an Excel spreadsheet, also lists a 90-day cancellation notice period"* — "that" carried the topic across turns, and the two genuinely agree |

### Still open in this area

- **Deictic sheet reference** — *"on that sheet"* still asks which sheet. Sheet
  selection reads the current prompt only. Unfixed.
- **"What I said earlier" about prose** — conversation-history reference, as
  opposed to document reference. Untested.
- **Two similarly named files** — untested.

---

## 20. Operational: staging ran out of disk

The `ordinals-0915` deploy failed mid-extract with **"No space left on device"**.
Staging kept serving `disclosure-0915` throughout and answered 200 — the release
is built and boot-tested before any cutover, so a disk-full build never reached
the running service.

Cause: **11 consumer releases on a 12 G volume**, five of them from this day's
rapid fix-deploy-verify cycles. Per-directory `du` reads 1.3 G each but the tree
totals 5.0 G — the releases share hard-linked files, so each additional one costs
about 506 MB of new blocks.

**Owner decision: grow the volume, delete nothing.** `pct resize 101 rootfs +8G`
on the pve host — `infra-data` had ~73 G free. Result: **12 G → 20 G, 7.6 G free,
60% used**, resized online with the container running and no interruption.

Two things the failure proved rather than cost: the deploy's build-then-cutover
order held, and `release-retention.sh` refused to run at all rather than prune on
a wedged disk — a pruning tool failing closed means deleting nothing.

One artefact remains: the incomplete `ordinals-0915` directory from the failed
run, which the completeness predicate certifies **cannot serve**. It is not
`current`, not `previous`, and retention would skip it. Left in place per the
no-deletion decision; the successful redeploy of the same name replaced it.

---

## 21. Release-space governance

Two changes at the two moments that matter, now exercised by a real deploy.

**Before anything is created on the host — a free-space gate.** "Free > one
release" is deliberately not the threshold: landing a release needs the payload,
the workspace to extract it in, and enough left that a way back still exists. So
the bar is **3× the payload**, and the payload is *measured*, not assumed —
`node_modules` is hardlinked from the live release rather than copied, so a
release costs about what the tar carries (**0.47 GB measured**) and nothing like
the 1.3 GB a release directory appears to occupy alone. A gate built on the
apparent size would have demanded 3.9 GB for a release that consumes half of one.
When it blocks it changes nothing on the host and prints the governed way to
reclaim.

**After the running process reports the new release — retention.** `--keep=1`:
active, rollback target, one more behind them. Only there, because every line
above can still fail and a pruning tool running during a wedged deployment
decides what to delete from a state nobody validated. Its failure is reported and
does not fail the deploy.

Retention also learned an explicit **pin**: a `.pinned` marker inside a release
keeps it regardless of age. Automatic retention answers *"what is needed to serve
and to roll back"*; a pin answers *"a human wants this kept"*, which no amount of
pointer-walking can infer.

**Result on the first real deploy through it:** consumer 11 → 3 releases, brain →
3, disk **60% → 41% used (12 GB free)**, both rollback pointers intact and
complete. The 20 GB expansion is now headroom rather than the fix.

---

## 22. 🚨 Raw internal failure text reached the user — FIXED

The Files view showed, as the description of an attached document:

```
Command failed: tesseract /tmp/migrapilot-ocr-rkUguC/page.png
/tmp/migrapilot-ocr-rkUguC/page.png.psm3 -l hat --psm 3 tsv
Error opening data file /usr/share/tesseract-ocr/5/tessdata/hat.traineddata
```

Server filesystem paths and a command line with its arguments, rendered as if it
described the user's file. It tells them nothing they can act on and tells anyone
reading over their shoulder how this machine is laid out.

**One line was responsible:** `return message.slice(0, 200)` — the raw error,
truncated, promoted to user-facing prose for every failure the two named cases
above it did not catch.

`describeFailure` now cannot return a raw message at all. Verified live, both
halves:

| surface | after |
| --- | --- |
| user | *"the text recogniser does not have the language pack this document needs"* |
| operator log | the full command, the missing file, and the TESSDATA_PREFIX hint |

---

## 23. OCR is installed — and my install advice was incomplete

`pdf_page_rendering` and `pdf_ocr` both now report **`available`**. The pipeline
genuinely runs: it rasterised all 245 pages of `liv_kreyol_AI-Training.pdf`
before failing.

It fails on one missing file. The scanned pipeline requests **`-l hat`** —
Haitian Creole — because this codebase measured `hat` as preserving more
diacritics than `fra` (35 v 22, 14 v 10). Installed languages are `eng`, `fra`,
`osd`.

🚨 **That gap is mine.** I reported the `hat` measurement in my own analysis and
then recommended installing `tesseract-ocr-fra`. The install followed the
recommendation, so the book still cannot be read.

For the OCR slice: `tesseract-ocr-hat` is what this document needs, and the
product should also degrade gracefully when a requested language pack is absent
rather than failing the whole job — the second half is a code change, not an
install.

---

## 24. Contextual reference resolution — COMPLETE

A **turn reference model** rather than a pile of patterns. `turnReference` holds
what a reference can point *at* — the ordered attachments, the sheet in play —
and resolution is matching a question against that state. **The candidates always
come from the files themselves**: real filenames, real sheet names. Nothing in
the module contains a list of things people might say.

### 🚨 Defect — the sheet was forgotten between turns

> *"Use the Q1 Sales sheet. What is the total revenue?"* → correct.
> *"On that same sheet, which region had the highest revenue?"* →
> **"the question doesn't specify which sheet to look at."**

`resolveActiveSheet` now searches recent turns for the **workbook's own sheet
names**, newest first. What makes a sheet active is having been *named* — not
having been pointed at with "that". A turn naming two sheets makes neither
active. A conversation that never named one resolves to nothing and the turn
asks, because the point of holding state is to answer *"which did they mean"*
from evidence, and inventing one would be worse than the forgetting it replaces.

Paid for only when there is something to resolve.

### 🚨 Defect — the evidence did not carry its own position

> *"What budget figure does the first document give?"* → the **second**
> document's figure.

The trace proved the order was resolved correctly
(`attachment_order: alpha-report-v2.xlsx | alpha-report-v1.xlsx`) and the model,
asked directly which file was number 1, answered **"alpha-report-v2.xlsx"**. It
knew which file was first and still read the wrong block: the ordinal lived in a
preamble and the filename lived on the evidence, so answering needed a join the
model did not always make.

The block now states its own position — the same identity the preamble gives,
written where the values are. The order trace was added first, because a
reference model that cannot be audited is a guess with extra steps.

### All five cases, verified live

| case | result |
| --- | --- |
| *"on that same sheet"* across turns | **Q1 Sales** carried; East, **$25,443.75** |
| *"what I said earlier"* | recalled the question **and** its figure, **$75,713.75** |
| similarly named files | distinguished `alpha-report-v1` from `-v2` correctly |
| **upload order ≠ alphabetical** | *"the first document"* → **v2, £512,000** — not the lexically-first v1 |
| ambiguous reference | *"The first document says there are 9 sites, but the second document says there are 7."* — both, positioned, nothing silently picked |

The fourth is the discriminating one: the pair is `alpha-report-v1` and `-v2`,
uploaded **v2 first**, so the alphabetically-first file and the actually-first
file are deliberately different.

### Release-space governance, exercised throughout

Every deploy in this slice passed the free-space gate (payload 0.5 GB × 3 = 1.4
GB required) and pruned itself to three releases afterwards. Disk has stayed at
41% with 12 GB free across five deploys.

---

## 25. Haitian Creole — measured, and it is the MODEL

Asked in Creole in the real product:

> *"Eksplike m an kreyòl ayisyen kisa yon kontra livrezon ye…"*

it answered with fluent-looking nonsense — `lakouchè` (childbirth) for a delivery
term, `li **no** fè` (English negation; Creole negates with **pa**), invented
vocabulary, and a definition that means nothing. **Confident nonsense in a user's
own language is worse than a refusal**, and it is the same class of failure as
the fabricated £54,212.

### Measured across installed models

Probes with verifiable answers — negation must be `pa`, figures must survive,
a comprehension question with one right answer — plus an open generation case,
which is what actually failed in the product.

| model | short translation | open generation |
| --- | --- | --- |
| `llama3.1:8b` **(what the product runs)** | passes | **degenerate loop**, meaningless |
| `qwen3:8b` | passes | **degenerate loop** |
| `qwen3:14b` | passes, cleanly — *"Kliyan an genyen 30 jou pou l peye."* | **best available, still unreliable** |

`qwen3:14b` produced one genuinely good explanation — *"Yon kontra livrezon se
yon akò kote… Li defini kondisyon, kantite, pwen livrezon ak pye"* — with two
wrong words (`twonp`→founisè, `pye`→pri). But two further probes were wrong: it
answered a customer-service question **in the first person** (*"**Mwen** ap genyen
45 jou"* — "**I** have 45 days") and misread an instruction entirely.

**So: no installed model does Creole the way it does English.** A model swap
alone will not deliver parity, though `llama3.1:8b` is clearly the worst of the
three and is what users get today.

### 🚨 Three harness faults, all found by disagreeing with reality

1. `num_predict: 160` truncated qwen3's reasoning block, so stripping it removed
   the **whole** output — a capable model scored 0/3 for a harness bug.
2. qwen3 returns an empty `response` with the answer in a separate `thinking`
   field. `done_reason: length`, `eval_count: 700`, **zero characters**. With
   reasoning disabled it answers *"M pa gen dokimèn la."* — correct Creole.
3. **Temperature 0 caused the repetition loops.** At 0.7 `qwen3:14b` stopped
   looping entirely. A conclusion drawn at temperature 0 would have condemned
   every model for a setting I chose.

The harness was wrong three times before the models were judged once.

### The corpus is already here, and OCR is what unlocks it

`liv_kreyol_AI-Training.pdf` — 245 pages, EPSON Scan, image-only — is Haitian
Creole training material the owner already holds. It is blocked on OCR, not on
anything conceptual.

§26 makes it readable today with `fra`; `tesseract-ocr-hat` makes it *good*.

### Honest scope

Reading, rendering and routing Creole is Chat's. **Making a model speak Creole is
training, and that is MigraAI Engineer's** — the boundary the owner set. What
this section provides is the evidence that decision needs, measured rather than
assumed.

---

## 26. OCR reads with the language the host has

`hat` was requested unconditionally, so on a host carrying only `eng`/`fra`/`osd`
the job died on one missing data file — **after rendering all 245 pages**, which
is the expensive half.

The language is now chosen from what is installed, preferring what was asked
for, in a **measured** order: this codebase measured `hat` preserving more
Haitian diacritics than `fra` (35 v 22, 14 v 10), making `fra` a real second best
and `eng` the last resort. A substitution is **reported, never silent** — a
reader told the text is Creole deserves to know a French recogniser read it.

🚨 The tests inject the language set. The first version asked the *host*, so on a
machine without tesseract every case hit an early return and asserted nothing —
four green tests covering nothing.

**Committed, not deployed** — see §27.

---

## 27. 🚨 BLOCKER: `HEAD` does not build

Commit `5f61fb75` ("brain: persist restart-safe engineer continuation")
committed `src/server.ts` referencing `allowRemoteModelsFromEnv` and
`allowRemoteModels`, while the files that **define** them —
`engine/models/eligibilityPolicy.ts` and `engine/chat/answerRoutes.ts` — were
left uncommitted.

```
HEAD tsc rc=1
  src/server.ts(1,10):   Module 'eligibilityPolicy.js' has no exported member 'allowRemoteModelsFromEnv'
  src/server.ts(466,5):  'allowRemoteModels' does not exist in type 'AnswerRouteOptions'
```

A clean clone does not compile, and **every Brain deploy is blocked** — the
deploy gate builds from the committed tree, which is the gate working correctly.
The OCR fix in §26 is waiting on this.

Not mine to fix: the remedy is the Engineer lane committing its working copy.
Committing it on their behalf would bundle unfinished work into a release.

---

## 28. Conversation fundamentals — the controls a user actually touches

| control | result |
| --- | --- |
| **Stop generating** | works, and genuinely aborts: text stayed byte-stable over 6s and the server recorded `outcome: cancelled` |
| Stopped answer survives reload | **no — by design**, see below |
| **Try again** | appended a new turn rather than replacing — consistent with this codebase's "fork, never rewrite history" rule |
| Try again produces *another* answer | **NO — byte-identical.** Defect, fixed |
| Copy / Listen / feedback controls | present and correctly gated; Listen names its missing runtime |

### Stopped answers are discarded, deliberately

> *"the answer is stored ONLY when the stream completes… writing a truncated
> answer would leave a durable conversation whose history claims the model said
> something it never finished saying."*

Sound reasoning, and it still costs the user text they read — ChatGPT keeps
stopped answers. The better resolution is to persist it **labelled as stopped**
rather than delete it, which needs a message-level field the Brain does not have.
**Flagged, not inverted**: a written decision is not overturned in passing.

### 🚨 Defect — "Try again" could not produce another answer

Asked *"in one short sentence, what is a bill of lading?"*, the retry reproduced
the previous reply **character for character**. A control whose label is *"ask
this question again for another answer"* that cannot produce another answer is a
dead control — the user clicked it precisely because they wanted something else.

**One setting, two defects.** Both model calls ran at `temperature: 0.1`:

- the **tool** call decides which capability to invoke and its output is parsed —
  a decision should be the same decision every time, so it stays at 0.1
- the **answer** turn is prose a person reads, and near-determinism made retry
  useless *and* made long-form generation collapse into repetition — which is
  exactly what made Creole look hopeless in §25, where every model looped at
  temperature 0 and produced coherent prose at 0.7

The answer turn now names its own sampling (`0.7 / top_p 0.9`); the tool turn
keeps its determinism, so the two cannot drift apart the next time either is
tuned.

Raising it does not loosen grounded figures: evidence blocks state figures and
instruct verbatim use, and copying a token already in context is not the branch
point sampling acts on. **To be re-proven against the grounded document cases,
not assumed** — blocked on sign-in below.

---

## 29. `HEAD` repaired, both Brain fixes deployed

The blocker in §27 is cleared. Owner chose repair over revert; the Engineer
lane's working copy was committed **unchanged**, in commits that say whose work
it is and why. Their suite was already green, so nothing unfinished shipped:
**3415/3415**, and `HEAD` now compiles standalone.

Deployed as `ocrlang-sampling-0919`, carrying both queued fixes. Migration 30
(`engineer_checkpoints`) is a `CREATE TABLE IF NOT EXISTS` for a new table —
purely additive, and a code-only rollback leaves an unused empty table.

`liv_kreyol_AI-Training.pdf` is re-running through OCR with the measured `fra`
fallback. **In progress, unverified.**

### 🚨 Blocked on sign-in

The staging session expired and `/api/auth/login` now serves the real MigraAuth
form. Authentication is never worked around, so the live re-verification —
retry producing a genuinely different answer, and grounded figures still exact
at the new sampling — waits for a manual sign-in at `http://127.0.0.1:3200`.

---

## 30. The Creole book is readable — as FALLBACK OCR, not corpus

`liv_kreyol_AI-Training.pdf` completed: **`ready_with_unplaced_pages`, 220 of 245
pages ordered**, no failure. It went from recovering nothing to a usable
document, without `hat` installed.

The recovered text is genuinely Haitian Creole:

> *CHAPIT 2 / Vokabilè kreyôl / Mo ki soti nan franse … / Mo ki soti nan lang
> Tayno … Edikasyon sivik / Devlopman kominotè / Ko-edikasyon*

### 🚨 And it is systematically mis-spelled, exactly as measured

The French recogniser renders every Haitian grave `ò` as a French circumflex `ô`:

| recovered | correct |
| --- | --- |
| `kreyôl` | **kreyòl** |
| `enpôtan` | **enpòtan** |
| `Pôtoprens` | **Pòtoprens** |
| `fômasyon` | **fòmasyon** |
| `ddinatè` | **òdinatè** |
| `JWEËT` | **JWÈT** |

This is the 35-versus-22 diacritic gap this codebase measured, now visible in
running output rather than in a note.

**So the owner's rule stands on evidence, not caution: this is FALLBACK OCR and
must not be treated as canonical corpus text.** A Creole *training* book whose
every `ò` is an `ô` would teach the wrong orthography — the failure would be
silent, systematic, and baked into whatever was trained on it.

`tesseract-ocr-hat` is what closes the gap. Until then the document is
legitimately readable and legitimately unsuitable as training material, and
those two facts are not in tension.

### What this proves about the fix

The fallback did its job precisely as designed: rendering had already been paid
for, one missing data file no longer throws it away, the substitution is recorded
rather than silent, and the degradation is exactly the measured kind rather than
an unknown one.

---

## 31. USER-OBSERVED: Haitian Creole answer quality (owner test, 2026-09-19)

The owner typed ordinary Creole in the real composer and corrected the assistant
repeatedly. Reproduced live on the candidate build `docpos-0918` / `ecc2107d`:

| turn | input | output |
| --- | --- | --- |
| 1 | `bonjou` *(good morning)* | **"Bonswa!** Kom ye nan tout bonè." — *good evening*, plus non-Creole filler |
| 2 | `it suppose to be Bonswa` | "Mèsi, Mèsi! Pou sa fe yon tout bagay yon konfizyon. Si wè, **Bondyè** proteje nou." |

Both answers also carried English "translations" that did not match their own text.
This reproduces the owner's `Bondja` / `Bondje` observation.

### What was ELIMINATED before blaming the model

The rule from the document slices applies: prove the input arrived before judging
the answer.

- **Text transform — NONE.** Every `toLowerCase`/normalize call in the chat path
  builds a local for classification. The outbound text is `opts.prompt` and
  `request.userPrompt`, passed through unmodified.
- **Context — WORKS.** Proven live in the same build, same session: "my favourite
  number is 47" → recalled; "actually it is 51, not 47" → **answered 51**.
  Correction-following in English is intact.

### 🚨 My first root-cause claim was WRONG, and the live test caught it

I concluded from code plus a Brain-level experiment that conversation history never
reached the model, because the consumer sends `memoryPolicy.store:false` and the
browser sends no `conversationSummary`. My experiment reproduced that flag but never
performed the message writes the consumer does by a different path, so it measured
an empty store and I read the emptiness as the product's behaviour. The real
composer answered "47" correctly and disproved it. **A faithful-looking harness that
omits one step of the real system produces a confident false root cause.**

### The measured defect

Four samples of `bonjou`, same model, same settings:

| # | output | verdict |
| --- | --- | --- |
| 1 | `Bonjou! Kijan ou ye?` | correct |
| 2 | `Bonjou! Comment ca va? Quoi de neuf?` | drifts to French |
| 3 | `Bonjour ! Comment ça va ?` | entirely French |
| 4 | `Bonjou! Kijan ou ye?` | correct |

**2 of 4 drift into French.** The served model is `llama3.1:8b` (tier `balanced`,
`selected llama3.1:8b [tier=balanced (wanted balanced)]`); alternatives present are
`qwen3:8b`, `qwen2.5-coder:14b`, `qwen3:14b`.

So Creole is **unreliable, not uniformly broken**, and it fails toward French — the
same nearest-high-resource-neighbour failure as the `fra` OCR fallback in §30.

### Classification

- Chat transport/context — **PASS** (live)
- Instruction/correction following — **PASS** in English (live)
- Haitian Creole lexical/orthographic quality — **FAIL**, measured
- Root cause — **model language quality + no language pinning**. Nothing in the turn
  instructs the model to answer in the language it was addressed in.

### Explicitly NOT done

No `Bondja -> Bonswa` mapping, no spelling heuristic, no Chat UI change. A patch like
that would make one screenshot pass while leaving Creole broken, and would put
product-owned language behaviour in the wrong layer. Routed to Engineer as
model/language qualification.

### 31b. The correction failure is a PRODUCT defect, not the model

Owner, on the turn-2 answer: *"this is bad creole and translating it doesn't make
sense at all."* Both halves are right, and they are two different defects.

**Correction to §31:** I wrote there that "nothing instructs the model to answer in
the language it was addressed in." That is FALSE. `openAiCompatProvider.ts` carries a
LANGUAGE directive ("reply in the SAME language the user wrote in … Never switch
languages on your own") plus a conditional `CREOLE_DISAMBIGUATION` hint, injected
only when the prompt contains one of `CREOLE_GREETINGS` — which includes `bonjou`
and `bonswa`.

#### 🚨 DEFECT 1 — a Creole token inside an English sentence flips the whole reply

The detector is `new RegExp('\\b' + greeting + '\\b', 'i').test(request.userPrompt)`.
It asks whether the greeting APPEARS IN the message, not whether it IS the message.
The owner's correction — "it suppose to be Bonswa" — is an English sentence that
happens to contain a Creole word, so the hint fires.

Measured on staging, with a control that separates cleanly:

| probe | result |
| --- | --- |
| `it suppose to be Bonswa` | **3/3 answered in Creole**, treating it as a greeting to answer |
| `it suppose to be good evening` (control) | **3/3 answered in English**, read as conversational |

So the correction was never ignored. It was STEERED: the model answered the word
`Bonswa` as a greeting instead of obeying the sentence about it. This fully explains
the owner's loop — every correction naming the right word re-triggered the same flip.

The code's own comment records that the UNCONDITIONAL hint "flipped English answers
into malformed Creole on 5 of 12 identical runs". Gating it was the fix. **The gate
reproduces the same failure in a narrower form**, because appearing-in is not is.

Shape of a correct fix (NOT implemented — owner routed this lane to Engineer): the
greeting must BE the message, not merely occur inside it. A sentence with English
syntax around a Creole token is English. No spelling map, and no new heuristic.

#### DEFECT 2 — Creole generation quality, model layer

Independent of defect 1 and unchanged: `bonjou` drifts to French 2 of 4 runs, and
the turn-2 output was ungrammatical — `Pou sa fe yon tout bagay yon konfizyon` has
two stray `yon`, `Si wè` is not meaningful, `Bondyè` is misspelled, and `Mèsi` is a
non-sequitur to a correction.

#### DEFECT 3 — the unasked-for translation MASKS defect 2

Nothing in the prompt path asks for a translation; the model volunteers it. It
rendered `Mèsi` ("thanks") as "No worries" and silently dropped the ungrammatical
middle clause entirely. A reviewer who does not read Creole sees fluent English and
concludes the turn worked. **That makes bad Creole invisible to exactly the people
most likely to sign it off** — a truthfulness problem, not a style one.

### 31c. Defect 1 fixed and deployed — the owner's loop is NOT resolved

Staging brain `creole-intent-0920`, commit `368eea36`, boot-tested, identity
asserted on the running process.

**Defect 1 — FIXED.** Proven deterministically at the transport boundary, which is
where a claim about the model's input belongs: five regression cases, and BOTH
directions negative-checked rather than assumed.

| control installed | which cases fail |
| --- | --- |
| the old substring gate | English correction, metalinguistic, quoted — the must-NOT-fire set |
| gate forced to always-false | standalone greeting, greeting + Creole continuation — the must-fire set |

Neither set is vacuous. Live confirmation, `it suppose to be Bonswa` as the FIRST
message of a fresh conversation — isolated from language inheritance:

> before: 3/3 full Creole greeting monologues (`Bonswa! Sak pase nan?` …)
> after:  **`Bonswa!`** — the correction accepted, not answered as a greeting

**A regression the suite caught, not me.** An image-only turn carries no
`userPrompt`. The substring gate survived that only because `RegExp.test(undefined)`
coerces to a string; `.replace` throws and would have killed the generation. Four
longRunningInference tests failed on it. No text is no greeting. 3421/3421, tsc 0.

#### 🚨 The owner's exact conversation STILL FAILS

Re-run through the real composer on the fixed build:

| turn | input | output |
| --- | --- | --- |
| 1 | `bonjou` *(good morning)* | **"Bonswa, kijan ou ye? Sak pase?"** — still the evening greeting |
| 2 | `it suppose to be Bonswa` | "Mèsi. Jou reyis se yon jounen mwens konsa. Chak bagay se bonmen." — malformed |

Defect 1 was a real cause and it is gone. It was not the only cause. Turn 1 never
depended on the gate at all: `bonjou` IS a greeting, the hint correctly ships, and
the model still answers a morning greeting with an evening one. Once turn 1 is
Creole, turn 2 inherits the conversation's language — correctly — and the reply is
malformed Creole.

**So the fix is necessary and not sufficient, and the lane must not be called
closed.** What remains is DEFECT 2 (Creole generation quality) and DEFECT 3
(unsolicited translations), both already routed to Engineer and both untouched here.
Fixing Defect 1 removed the reason the user could not correct their way out; it did
not make the assistant speak Creole.

---

## 32. PPTX — a deck is readable, slide by slide

`.pptx` was refused with NO_EXTRACTOR: truthful, and by the standing rule still a
missing capability. It now has a reader. No new dependency — JSZip was already
carried for `.docx` and `.xlsx`.

### Proven through the real composer

Staging `pptx-0920` / `648866f8` (both services). A genuine 12-slide PowerPoint deck
uploaded, chipped **"Ready — MigraPilot can read this · 2.0 MB"**, and answered:

> According to the context retrieved from `team_kickoff_2026.pptx`, the agenda is
> listed on **Slide 2** (team_kickoff_2026.pptx:6-13). The agenda includes: …
> [all six items, recovered from the slide's TABLE]

Slide-level provenance, which is a deck's equivalent of a page citation.

### Three traps, all of which produce confident wrong answers

- **Slide order is not filename order.** Real order is `sldIdLst` resolved through
  the rels. Filename order agreed 3/3 on real decks — but reordering slides in
  PowerPoint rewrites the manifest and LEAVES FILENAMES ALONE, so a reordered deck
  would answer "the third slide says…" confidently and wrongly.
- **A table is not a list of cells.** The §DOCX lesson; rows stay `cell | cell`.
- **`notesSlideN` does NOT correspond to `slideN`.** Pairing by number staples one
  slide's notes to another — worse than no notes, because it reads as evidence.
  Resolved through each slide's own relationships.

### What real files caught that a fixture never would

Validated against three genuine PowerPoint decks BEFORE writing a fixture. Every
real notes part carries the notes master's slide-number placeholder, so the first
run emitted `Speaker notes: 1` for decks with no notes at all, and set `hasNotes`
true on all three. Master furniture (`sldNum`, `dt`, `ftr`) is now dropped.

### 🚨 Two defects the tests caught in my own work

1. **A vacuous test.** The notes-pairing test asserted the right slide HAS the
   notes and never that the wrong slide does not — so a negative control that
   paired by number still passed. Strengthened until the control bit.
2. **A claim that reached nobody.** `hasUnreadCharts` was computed and then dropped
   by the dispatcher, so "charts are reported" was true of the extractor and false
   of the product. It now sets `complete: false`, which the evidence layer already
   renders as "This is based on part of the file, not the whole file" — exactly
   true of a deck whose figures live inside a chart.

### A second source of truth, removed

`contentMismatch` decided which indexed types must be plain text with a hardcoded
`ext !== 'pdf' && ext !== 'docx'`. Making `.pptx` indexed silently enrolled it, so a
real deck was refused at upload as *"a zip archive, not a .pptx file"*. Binary-ness
is now DECLARED on the type, so the next binary format is caught at review rather
than at a user's upload.

### Status

Brain 3430/3430, consumer 1311/1311, tsc 0. Implemented → staging-deployed →
automated end-to-end verified → **READY FOR LOCAL USER TEST**. Not user-proven.

Known limits, stated rather than discovered: chart series values and embedded
workbooks are not read (declared per deck), and `.ppt`/`.odp` remain refused —
different formats, no reader.

---

## 33. A stopped answer is part of the conversation

**Contract.** If the user presses Stop after receiving partial assistant text, the
text they can see is part of the conversation and must survive reload,
conversation switching, and later continuation.

Persisted on `conversation_messages.status`, which the column already allowed — no
migration, no parallel mechanism. `stopped` is a distinct status, not `failed` and
not `partial`.

### The discriminator is the REQUEST, never the text

A user stop drops the connection, so `request.signal.aborted` is true; a stream that
dies on its own leaves it false. Nothing infers intent from how finished the answer
looks — that is exactly how a dropped connection gets labelled as a decision the
person never made. The pre-existing test "a stream that ends without `done` persists
NOTHING" passes unchanged and is the standing control for this.

### Live matrix on staging `stopnotice-0920` / `b4f60c9f`

| criterion | result |
| --- | --- |
| survives reload | PASS — full text returned |
| survives conversation switching | PASS — via History, text and mark intact |
| visibly distinguishable | PASS — distinct notice, returns after reload |
| continuation does not treat it as complete | PASS — model resumed mid-narrative, Newark/Oakland -> 1968 Rotterdam |
| no duplicates, no empty turns | PASS — records carry their own status |
| transport failure is a different path | PASS — standing automated control |
| **Try again on a stopped turn** | PASS — appended a new turn; stopped record untouched |

Retry sequence, read back from the store: 4 records — the stopped turn keeping its
text and `status=stopped`, then a repeated question and a new complete answer. After
reload: two assistant turns, exactly ONE stopped notice.

**Try again needed no new mechanism, and the reason matters.** `askAgain.ts` records
that the store is APPEND-ONLY: there is no operation to delete one message, truncate,
or fork. So "regenerate" here has always meant append, never replace — which
satisfies every constraint by construction rather than by added guards. `canAskAgain`
already allowed a stopped last turn; tests now pin it, including that it must not
appear while the turn is still streaming.

### 🚨 The trust defect this slice created, and then fixed

The stopped answer survived reload with this sentence still under it:

> "It was not finished, so it was not saved — it will not be here after you reload."

It WAS saved. It WAS there. The user could disprove the product in one click. That
sentence was true until the turn before; persisting stopped answers made it false and
nothing re-read it — the same failure as the capability line claiming MigraPilot could
not read PDFs while it was answering from one.

It now reads: **"You stopped this answer. It is incomplete, and it has been kept in
this conversation."** Both halves are load-bearing. Incomplete without kept leaves the
old implication that it is about to vanish; kept without incomplete invites a
truncated answer to be read as finished.

An existing assertion was INVERTED rather than deleted. It required the words "not
saved" for the right reason at the time — do not imply a persistence that did not
happen. The same rule now demands the opposite words, because denying a persistence
that DOES happen is the same lie from the other side. A green test holding a false
sentence in place is worse than no test.

### Stated honestly: one criterion not proven live

"Stop before any assistant text" could NOT be reproduced through the composer —
first-token latency is shorter than a browser round trip, so winning that race would
be luck rather than method. It is covered deterministically by
`STOP before any assistant text writes NO assistant turn`, which holds the stream
open emitting nothing. That is stronger evidence than a race, and it is not the same
as a live pass; recorded as what it is.

### Status

Brain 3432/3432, consumer 1319/1319, tsc 0. Implemented → staging-deployed →
live matrix verified → **READY FOR USER TEST**. Not user-proven.

### 33a. Two points held explicitly, at the owner's instruction

**1. Try again on a stopped turn APPENDS. It is not replacement.**
The result is a repeated user turn plus a new assistant turn, both visible. The
stopped turn keeps its text and its `stopped` status. This is not a limitation
working around a missing feature — it is the store's append-only semantics being
told truthfully by the UI, instead of faking a "regenerate" model the system does
not have. A transcript that rearranged itself on reload would be the alternative,
and it would be worse.

**2. Zero-token stop is AUTOMATED-ONLY evidence. It is not a live pass.**
First-token latency is shorter than a browser round trip, so racing it through the
composer would be luck rather than method. It stays covered by a deterministic test
that holds the stream open emitting nothing. It must not be written up, counted, or
summarised as live-verified until something can actually reproduce it live.

---

## 34. Conversation-state: context compression altered meaning

Owner priority 1 — long-conversation context continuity. Two defects found by
measuring `buildContext` directly rather than by reading it.

### 🚨 DEFECT — FIXED: the context had silent holes in it

The budget loop walked newest to oldest and `continue`d past anything that did not
fit, so an oversized turn vanished and the turns around it were handed to the model
as neighbours. Measured on a five-turn conversation with one long turn 3:

```
TURN1 my account number is 4471
TURN2 noted
TURN4 acknowledged          <-- TURN3 gone, nothing said
TURN5 what is my account number?
```

The assistant appears to have acknowledged something that is not there. **False
adjacency invents a relationship between turns that were never neighbours**, which
is worse than showing less — the model cannot even know to be careful.
`omittedForBudget` counted it, and the model never sees diagnostics.

**Fixed by replacing the omitted turn with a marker IN ITS PLACE**, carrying the
omitted message's own role, and continuing the walk.

Two other designs were tried and rejected, and both are kept as negative controls
because each fails a different assertion:

| design | what it gets wrong |
| --- | --- |
| silent skip (the original) | false adjacency, no disclosure |
| stop at the first oversized turn | no false adjacency, but drops a turn-1 account number that fits easily, to pay for a long turn 3 |
| **marker in place** (shipped) | keeps everything that fits, and nothing is adjacent to what it was not |

### 🚨 DEFECT — OPEN, NOT FIXED: summarization never runs

`summarizeConversation` exists, works, and is reachable **only** through
`POST /api/ai/conversations/:id/summarize`, which **the consumer never calls**.
Nothing triggers it automatically. So `getLatestSummary` finds nothing in
production and `summaryUsed` is always false: the compression half of context
management is, in practice, dead code.

The consequence is now visible rather than hidden: once a conversation outgrows the
3000-token budget, its beginning is marked as omitted and is **gone**, with no
compressed form carrying its facts forward. The marker keeps that honest; it does
not make it good.

**Not fixed here deliberately.** Automatic summarization means a model call on a
cadence, which is cost, latency and failure-mode policy — an owner decision, not a
detail to slip into a defect fix. Recorded for the owner with the evidence.

Brain 3435/3435, tsc 0.

### 34a. APPROVED, SCHEDULED LAST: context-pressure summarization

Owner decision: enable automatic conversation summarization as a **governed
context-management subsystem**, not "summarize every N turns".

**Target behaviour**
- keep the most recent raw turns verbatim
- preserve older important information through a conversation summary
- refresh the summary only when context actually crosses a threshold
- never summarize every turn
- keep the summary SEPARATE from raw history, so provenance stays clear
- if summarization fails, fall back to the honest omission marker rather than
  pretending memory exists
- never let a summary silently overwrite or mutate the transcript

**Trigger is CONTEXT PRESSURE, not message count.** At a high-water mark near the
usable token ceiling, summarize the oldest eligible segment, store it, and keep the
newer raw turns intact.

**The summary carries structured state, not only prose**: durable user facts stated
in the conversation, active task/topic, decisions, unresolved questions, referenced
files/artifacts, names/numbers/details needed later, and prior constraints or
corrections. The account-number case must survive after its turn leaves the raw
window.

**Two safeguards the owner insisted on**
1. Summaries are REPLACEABLE AND VERSIONED. Summaries can be wrong; when the user
   corrects something or the model contradicts it, the next refresh updates the
   summary rather than freezing stale facts forever.
2. Attachments are NOT summarized away into prose. The summary may say which files
   are active and what was learned, but the underlying file references and
   provenance stay addressable.

**Sequenced LAST on purpose.** Edit, delete and interruption semantics define what
the canonical conversation state even IS. Summaries depend on that state, so those
are settled first: edit-and-ask-again -> delete/archive -> interrupted streaming ->
attachment context across long chats -> this.

---

## 35. Edit-and-ask-again is sound. Page provenance was not.

Owner priority 2 — edit-and-ask-again semantics. Tested live on staging
`stopnotice-0920`, and the concern it was raised for does not reproduce.

### Edit-and-ask-again: PASS

A document was attached, asked about, then re-asked through "Edit this question
and ask again":

| check | result |
| --- | --- |
| transcript stays honest | PASS — the control loads the text back into the composer and APPENDS; it never edits history, and the label says so |
| stale assistant context | PASS — no answer is re-parented to an edited prompt; the original question and its answer stay where they were |
| evidence survives the edit | PASS — the re-asked question was still grounded: "the account manager reference number is NW-88213 (vendor_terms.md:9-11)" |

The composer does not re-display the attachment chip on reuse — the draft carries
text only. It is NOT a correctness defect: grounding is the conversation's active
set, decided server-side, and the answer was grounded. It does mean the composer
UNDER-states what is in scope, which is the safe direction and is noted rather
than changed.

### 🚨 DEFECT — FIXED: a file with no pages was cited as "page 2026"

Found while verifying the above, on the real product:

> vendor_terms.md · **page 2026**

The file is Markdown. It has no pages. `2026` came from its own heading,
`# Northwind Vendor Terms 2026`.

**Cause: an overloaded field.** A chunk's `symbol` carries a page label for a paged
document, a code symbol for source, and a HEADING for prose — measured directly:

```
symbol="Northwind Vendor Terms 2026"   lines 1-2
symbol="Payment" / "Penalty" / "Contact"
```

`aiRoutes` mapped `symbol` -> `location`, scraped every digit run out of it, and
expanded first..last into a range. So a heading containing a year became a page —
and a heading reading "Section 3 to 9" would have produced SEVEN fabricated page
citations. That is exactly the fabricated span the code's own comment forbids,
arriving through the one field nobody checked.

**Fix: only a label the pager itself wrote counts as a page.** `pageLabel` already
emits `page 7` / `pages 7-8`, so the shape is the discriminator. Anything else
yields no page at all — under-reporting provenance, which is the correct direction
to be wrong in. Extracted as `pagesFromChunks` so the invariant is testable.

Seven tests, negative-checked: restoring the digit scrape fails exactly the three
"must not be a page" cases while the four legitimate-page cases still pass, so they
discriminate this defect rather than detecting change.

Brain 3442/3442, tsc 0.

### 35a. Conversation-state batch — running state

| item | state |
| --- | --- |
| Edit-and-ask-again semantics | **PASSED** (live, staging) |
| Attachment scope visibility in composer | UX understatement, not a correctness failure — **BACKLOG** |
| Context-gap omission marker | implemented + tested, **awaiting batched staging deploy** |
| Citation page-fabrication fix | implemented + tested, **awaiting batched staging deploy** |
| Automatic conversation summarization | approved design direction, **not yet integrated** |

Owner's rule for the batch: nothing deploys until the batch is complete, and when it
reaches staging the two already-fixed defects are re-run LIVE as part of the pass —
the omission marker must appear exactly where continuity is broken, and a Markdown
heading containing a number must never render as a page citation. Batching without
losing runtime proof.

Remaining order: delete/archive -> interrupted streaming -> attachment context across
long chats -> summarization integration -> batched deploy -> live regression pass.

---

## 36. Delete/archive — one capability absent, one defect fixed

Owner priority 3. Brief: prove the UI language matches the actual persistence, and
that deleting does not take files still referenced elsewhere or leave orphan state
without a retention policy.

### ARCHIVE DOES NOT EXIST

The conversation controls are **Rename, keep a copy, and Delete** — there is no
archive, anywhere in the consumer. So "archive only hides and stays recoverable"
has nothing to verify. Recorded as a MISSING CAPABILITY, not a defect, and not
invented to satisfy a checklist.

### Delete: the language is accurate, and the files are safe

| check | result |
| --- | --- |
| "delete it for good" really removes it | PASS — conversation, messages and summaries all go, in one transaction |
| already-deleted is not an error | PASS — a double click lands the user where they asked to be |
| attached files survive | PASS — delete touches no file; a library file may be referenced by other threads and is the user's, not the conversation's |
| files deleted LATER do not corrupt a transcript | PASS — `missingFileRefs` is computed against the CURRENT library at read time, so a deleted source renders as deleted rather than as a live one |

### 🚨 DEFECT — FIXED: "for good" was leaving two tables behind

`message_feedback` and `conversation_project` both carry `conversation_id`, and
**neither has a foreign key or a cascade** to `conversations`. The delete cleared
messages, summaries and the conversation row, so those two survived permanently:

- **message_feedback** — the user's own up/down ratings on messages in a thread they
  asked to be rid of. Deleting the conversation and keeping the opinions about it is
  not "for good", and it is their content.
- **conversation_project** — a binding pointing at a conversation that no longer
  exists.

Neither is visible in the UI, which is exactly why nothing noticed. **Orphan rows
with no retention policy are not harmless: they are data a user asked to have
deleted, kept because no query happened to join to it.**

Both are now cleared in the same transaction, BEFORE the conversation row, so a
failure leaves the thread intact and retryable rather than half-deleted.

Three tests, asserted on the statements issued rather than against a live database,
because the property under test is what the delete REACHES. Negative-checked:
removing the two new deletes fails the completeness test. The tests also pin the
ordering, and that no delete is ever unfiltered — an unscoped DELETE here would
empty a table for every user at once.

Brain 3445/3445, tsc 0. Awaiting the batched staging deploy.

---

## 37. Interrupted streaming — the product was claiming an intent nobody had

Owner priority 4. The defect was in my own stopped-answer slice, found by running
the case the owner named.

### 🚨 DEFECT — FIXED: a reload was recorded as a deliberate user stop

Measured live on staging `stopnotice-0920`: a long answer was started and the page
was **RELOADED** mid-stream. The persisted record:

```
assistant  status=stopped  **The Suez Canal: A Waterway of Strategic...
```

So the transcript told the user they had deliberately stopped an answer they never
stopped, and the UI rendered "You stopped this answer" over it. **A false claim
about a person's intent, on a record they keep.**

**Cause.** Stop, reload, tab close and a dropped network all abort the request
identically, so `request.signal.aborted` cannot mean "decision". The stopped slice
read it as one.

**Fix: the browser declares.** Only it saw the click. An explicit Stop POSTs
`/api/chat/stop` naming its own request id and THEN aborts; anything else is
`interrupted`, which claims nothing about why. The stream route waits briefly for a
declaration — only on a turn already aborted with text — because the declaration
and the abort race across the network.

The declaration has no authority: it can only downgrade `interrupted` to `stopped`
on a turn that was already aborted with text, it is scoped to the principal who
owns the turn, and it is consumed on read so a later interruption cannot inherit
an intent never expressed for it. In-memory with a seconds-long window, which is a
real limit recorded in the module rather than hidden: a restart mid-turn loses the
declaration and the turn records as interrupted — truthful, just less specific.

### The four states, now distinct

| what happened | stored | what the reader is told |
| --- | --- | --- |
| natural completion | no status | nothing — it finished |
| user pressed Stop | `stopped` | "You stopped this answer." |
| reload / tab close / dropped network | `interrupted` | "This answer was cut off." |
| transport failure | nothing persisted | the turn reports the failure |

Context marks the two partials differently for the same reason — a stop is a
decision, an interruption happened TO them, and telling the model they chose it
would be a small lie about a person who is right there to contradict it.

### The owner's remaining criteria

| criterion | result |
| --- | --- |
| reload must not show the turn as complete | PASS — it is `interrupted`, never absent-status |
| no junk empty assistant message | PASS — persistence is guarded on non-empty text |
| reload must not duplicate turns | PASS — measured, 2 records for one turn |
| server truth wins the disconnect race | PASS — `completed` is checked FIRST, so an answer that finished before the abort landed stores as complete |
| retry after interruption appends cleanly | PASS — append-only, and the interrupted record is untouched |

An existing test was corrected rather than deleted: "a browser that hangs up
mid-answer" now expects `interrupted`, because its own name says nobody pressed
Stop. Negative-checked — treating any abort as a stop fails exactly that test.

Consumer 1325/1325, Brain 3445/3445, tsc 0. Awaiting the batched staging deploy.

### 37a. The stop declaration is a DURABILITY limitation, not a correctness one

Recorded at the owner's instruction. The declaration lives in memory for seconds.
If the consumer restarts inside that window, an explicit Stop records as
`interrupted` instead of `stopped`.

**That degrades toward truth.** "Cut off, reason unclaimed" is less specific than
"you stopped this", and it is not false — the answer really was cut off. The
failure this replaced went the other way: it asserted an intent the user never
had. A durable store would be needed for multiple consumer instances; there is one
today, and the limit is written in the module rather than discovered later.

The four states and what each may claim:

| state | means |
| --- | --- |
| `complete` | the server finished |
| `stopped` | explicit user intent, declared by the browser that saw the click |
| `interrupted` | generation cut off, claiming nothing about why |
| failure | transport/provider error — persists nothing |

---

## 38. Attachment context across long chats

Owner priority 5. Tested live on staging `stopnotice-0920`: a lease summary
attached, an unrelated turn, a second document attached, then references back.

### What PASSED, and why it is stronger than I expected

| case | result |
| --- | --- |
| attach early, unrelated turns, refer back loosely | PASS — "Go back to the lease document from earlier — what is the annual rent?" answered **84,000**, citing both files |
| purely POSITIONAL reference | PASS — "What does the first file I attached say about its term?" quoted "The lease runs for 7 years from 1 March 2026" |
| identity survives transcript trimming | PASS by construction — grounding is the conversation's DURABLE file set, not the transcript, so context budget cannot erase which files exist |
| deleted file marked on historical turns | PASS — `missingFileRefs` renders "no longer in your library" on the turns that attached it |

I expected the positional case to fail and it did not. The ordinal reference model
and the durable grounding set carried it.

### 🚨 DEFECT — FIXED: a deleted file was answered around, not reported

The lease summary was deleted from the library. Asked **"In the lease document,
which year is the rent review?"**:

> "The term of the document is 2026 **(vendor_terms.md:1-2)**."

A DIFFERENT file, cited, with nothing in that turn saying the lease was gone. The
historical chips said "no longer in your library"; the ANSWER did not. **A
confident answer about the wrong document is worse than a refusal, because the
citation invites the reader to trust it.**

**Cause.** Reconciliation drops a deleted file from `available` — correct, it is
gone — and the turn then proceeds as if the user had never referred to it, so the
narrowing rules pick some other document.

**Fix: state the loss.** `reconciled.missing` already existed and nothing read it.
The turn now carries the files this conversation HAD and no longer has, with an
instruction to say so and not to answer from a different document.

**Stated unconditionally, not gated on the prompt naming the file** — and that is
the load-bearing decision. `mentions()` does not match "the lease document" to
`lease_summary.md` by stem or by spacing, so a matched-only disclosure would have
stayed silent on the exact case that produced the defect. The fact is short, true,
and appears only on a conversation that has actually lost a file.

### Noted, not changed: deleting a library file has no confirmation

One click on the Files page destroys a file irreversibly, with no confirm step —
while deleting a CONVERSATION is described as "delete it for good". Recorded as a
UX risk for the owner rather than changed inside a context slice.

Consumer 1329/1329, tsc 0. Awaiting the batched staging deploy.

### 38a. PRODUCT UX GAP: file deletion has no confirmation

Recorded at the owner's instruction, not changed inside a context slice.

Deleting a file from the Files page is **one click, irreversible, and unconfirmed**,
while deleting a CONVERSATION is framed as "delete it for good". The asymmetry is
backwards: the file deletion is the one that also breaks future grounding for every
conversation that used it, as §38 demonstrates.

The distinction that matters, and which §38 now enforces:

> The historical transcript may truthfully show that a file USED to exist. The
> current turn must truthfully acknowledge that the file is no longer available for
> grounding — and must never answer from a different document merely because
> something else is still attached.

---

## 39. Context-pressure summarization

The approved design from §34a, implemented. §34 established that
`summarizeConversation` worked and was reachable only through a route the consumer
never called — so `getLatestSummary` found nothing in production and a conversation
that outgrew its budget simply lost its beginning. **This is the trigger that was
missing**, plus the rules the owner set around it.

### The rules, and where each one lives

| rule | how it is met |
| --- | --- |
| trigger by context PRESSURE, not turn count | `readContextPressure` measures tokens over the same message set the context builder would show, against 75% of the budget |
| summarize only the older portion | `keepRecent` excludes the newest turns from the eligible range |
| keep recent raw turns verbatim | those turns are never compressed, so context never carries a lossy copy above an exact one |
| file references kept SEPARATE from prose | `SummaryBody.files`, rendered as "still the source for what they contain — do not quote them from this summary" |
| versioned | `addSummary` already versions, and each summary is source-bound to a message id range |
| refreshable / correctable | summaries are additive and the newest wins; a later refresh covers the range after the last one |
| failure falls back to omission markers | the trigger is wrapped and best-effort; on failure the context builder still marks what it could not fit |
| never mutate the transcript | nothing here writes to `conversation_messages` |

**Triggered AFTER the answer is committed**, so a user never waits on compression
for an answer they already have, and a summarisation failure can never fail a turn
that already succeeded.

### 🚨 Why this summariser stays EXTRACTIVE, and why order is the whole design

The owner's acceptance case: a fact stated early, corrected later, then compressed.

A summariser that "resolves" the contradiction has to decide which of two things a
person said is true, and it decides wrong exactly when it matters. **Every
statement is kept, in order.** The correction is then the last thing said on the
subject — which is what a reader and a model both take it to mean — and neither the
original nor the correction is silently discarded. Rewriting the two into one
sentence is precisely where a stale value becomes the permanent one.

Proven, and negative-checked twice because the property has two ways to break:

| control | result |
| --- | --- |
| reverse the extracted statements (lose order) | correction test FAILS |
| keep only the first statement (a "resolving" summariser) | correction test FAILS |
| drop `body.files` | attachment-reference test FAILS |

A first attempt at the order control did NOT bite — it deduplicated on a 12-character
prefix and the two statements differ there. The control was wrong, not the test;
rebuilt until it attacked the property rather than the wording.

### One default chosen deliberately

`keepRecent` defaults to **0**, not 6. The manual `POST /…/summarize` route means
"summarise what is there", and silently withholding its newest turns would change
what that endpoint does to every existing caller. The pressure trigger — the thing
that exists to keep recent turns raw — passes its own value.

Brain 3453/3453, consumer 1329/1329, tsc 0. Completes the batch.

### 39a. TWO DEPLOYMENT RULES, learned by breaking them

Both were procedural failures on the `convstate-0920` batch. Neither was a product
regression, and staging never cut over to a broken consumer — the gates held.

**1. The consumer pre-deploy gate is `npm run verify` IN THE APP.**
Not root `tsc -b`. The root build does not typecheck the Next application, so it
stayed green while `app/api/chat/stop/route.ts` imported `resolveRequestPrincipal`
from the wrong module. A green root build had been treated as coverage it never
provided. The app's own gate — typecheck, tests, build, bundle check — refused the
deploy, which is the gate working.

**2. No arbitrary wall-clock timeout around a deploy script.**
A 110-second `timeout` was wrapped around a deploy that takes 10–20 minutes, and it
SIGTERM'd mid-build. That turns a slow success into a spurious failure and leaves a
partial release directory to reason about. The governed deploy owns its own
lifecycle; if it must run asynchronously, background it and inspect its real result.

A third thing the failure prevented, worth recording because it was luck rather
than design: another lane committed DURING the batch, so the consumer step read a
different HEAD than the brain step had. Had the consumer succeeded, the two
services would have shipped different commits under one batch name.

---

## 40. Live regression pass — the conversation-state batch

Deployed pair: brain `convstate-0920` / `feb6ea6c`, consumer `convstate-0920b` /
`84d9c289`. All six verified against the running staging product.

| # | change | evidence |
| --- | --- | --- |
| 1 | context-gap marker | `omittedForBudget: 1` under real pressure, and the model said "I can see all your messages, but the last one seems to be missing **the long message that preceded it**" — it knows a turn was left out |
| 2a | page provenance, NEGATIVE | `vendor_terms.md` renders with **no page suffix**. Was "· page 2026", scraped from its own heading |
| 2b | page provenance, POSITIVE | `meridian-agreement.pdf · pages 1-5` on a genuinely 5-page PDF, answer correct — the fix did not silence real citations |
| 3 | delete completeness | confirmation dialog, then `GET …/messages` → **404**; the PDF used by that conversation is still in the library |
| 4a | explicit Stop | `status=stopped` |
| 4b | reload mid-generation | `status=interrupted` — was `stopped` before the fix |
| 4c | natural completion | no status |
| 5 | missing-file disclosure | "I do not have that document attached to this conversation, so I cannot answer from it yet." Before the fix the same question answered from a DIFFERENT file, with a citation |
| 6 | summarization | turn 3 fires the trigger; turn 4 reports **`summaryUsed: true`** with `recentMessagesIncluded: 12`; answer returns the corrected 5582 |

### Two limits of this evidence, stated rather than blurred

**#6 does not isolate "the correction survived VIA the summary."** Turn 4's raw
window still contained the correction (`recentMessagesIncluded: 12`), so the right
answer is consistent with either source. The isolated property — order preserved,
correction last, neither value discarded — is proven by unit tests with two negative
controls. The LIVE run proves the trigger fires and the summary is used, which is
the gap §34 found. Conflating the two would be the kind of claim this programme
exists to refuse.

**#3's orphan-row clearing is not live-verifiable here.** `message_feedback` and
`conversation_project` have no read surface and the DB is not accessible from this
lane without credentials. The SQL is asserted by tests on the statements issued,
including ordering and that no delete is unfiltered. Live, what is proven is that
the conversation is gone and its files are not.

### Also observed

`meridian-agreement.pdf · pages 1-5` is broad for a 5-page document — every page was
retrieved. It is in-bounds rather than fabricated: the property the fix guarantees is
that a cited page EXISTS and came from a pager-authored label, not that retrieval is
narrow.

Conversation delete HAS a confirmation dialog. File delete still does not — §38a.

### Status

**Conversation-state batch: staging-proven / READY FOR USER TEST.** Not user-proven.
NOT production-ready: the Brain lineage gate (§IV §1, `release/engineer-three-track`)
is separate, unresolved, and unaffected by any of this.

---

## 41. 🚨 BLOCKS THE OWNER TEST: the staging session ends silently after ~15–20 minutes

Found while starting the naturalistic pass. It stopped that pass, and it will meet
the owner the moment they sit down to test.

### What was measured

| time | state |
| --- | --- |
| 19:16:47 | consumer restarts (deploy cutover) |
| 19:17–19:23 | **signed in** — files uploaded, chats run as the owner |
| 19:42 | **signed out** — "Sign in to attach documents", 401s on `/api/files` |

No restarts between 19:23 and 19:42. An earlier occurrence matched: signed in,
then signed out roughly 21 minutes later.

### 🚨 A correction to something already reported

I previously told the owner that **a consumer deploy signs users out**. That was
WRONG, and the timeline above is why: the session survived the 19:16:47 restart and
worked for six minutes afterwards. The logout is time-based, not deploy-based. The
claim never reached this document, but it was said, so it is corrected here.

### What the code says, and where the investigation stopped

`migraAuthApi.ts` mints `accessTokenExpiresAt` from `(expires_in ?? 900) - 30` — a
**15-minute** access token by default. A refresh flow exists and is properly built
(one-time rotation, in-flight de-duplication, explicit `persistRenewal` because
replaying a rotated token revokes the whole family).

So the token lifetime matches the symptom, and the refresh either is not firing or
is failing. **Nothing is logged** — `journalctl` for the consumer has no auth,
refresh, reauth or 401 line for the whole window. A session ending with no record is
its own defect: there is nothing for an operator to read.

Diagnosis stopped there deliberately. MigraAuth internals belong to the auth lane,
which has its own unresolved reconciliation, and the Chat lane guessing at token
rotation would be the scope creep this programme keeps refusing.

### Why it matters beyond the test

A chat product that signs a person out roughly every fifteen minutes of thinking
time is not usable for the work it exists to do — a long document conversation is
exactly the session that idles. Recorded as a **defect candidate for the auth lane**,
with the measurement rather than a theory.
