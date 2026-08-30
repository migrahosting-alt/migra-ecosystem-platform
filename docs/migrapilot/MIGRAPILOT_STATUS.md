# MigraPilot — Master Status

**`MIGRAPILOT_STATUS.json` is canonical.** This page is the human-readable summary of it.
Both are updated together, on every material change.

Why this exists: work kept discovering something, moving three lanes away, and then having to
reconstruct what was finished — or why a decision was made — from conversation history. Every agent
(Claude, Engineer, MigraPilot) reads this instead.

_Last updated: 2026-08-30_

> ⚠️ `CLAUDE.md` and `AGENTS.md` are **gitignored** in this repository, so the pointers added there are
> local only. This file and its JSON are the tracked copies — link to `docs/migrapilot/` from any new
> instruction file rather than relying on a root-level one to travel.

---

## Standing rules

| Rule | Meaning |
|---|---|
| **Easy first** | Do not start deep capability work while meaningful easy user-facing items remain. |
| **PROVEN_LIVE** | Requires the real user-facing workflow to pass. Code existing and tests passing is **not** proof. |
| **Acceptance gate** | The app's own test command **+ `tsc -b` + live browser**. A pre-commit hook is not the acceptance suite. |
| **Cost discipline** | owned → open-source → self-hosted → free tier → partner credits → paid. Nothing recurring enters quietly. |
| **Honest unavailable** | A capability that is not ready refuses truthfully rather than appearing to work. |

---

## Deployment backlog cleared 2026-08-30 — four records were stale, one capability was missing

The consumer deploy that shipped the upload trigger also carried work that had been sitting
**built, green and undeployed** since 28–29 August. Verified in production:

**Upload ceiling — `PROVEN_LIVE`.** A 47.7 MB PDF (50,062,914 bytes) uploaded through the real
picker landed intact and started reading. The old proxy cut was measured at 32.2 MB → 413.
Advertised `maxFileBytes` is 268435456 (256 MB), so the app no longer promises a ceiling the
transport will not carry. The ordering constraint recorded in that slice was honoured: nginx on
VM102 was raised to 256M **before** the app advertised it.

**Multi-turn conversation memory — `PROVEN_LIVE`, and it never worked before.** The consumer had
no `conversationId` on its chat-turn operation, so the Brain's entire durable-memory path was
gated on a value that never arrived. Fresh chat, no attachments:

> "Remember this code: DELTA-8836" → "Acknowledged: DELTA-8836."
> "What was the code I just gave you?" → "The code you just gave me was DELTA-8836."

That is the exchange that previously answered with an invented Python function. After a **full page
reload** it still answered "…was DELTA-8836", so the memory is reconstructed from the Brain rather
than held in the page.

**Grounding isolation — `PROVEN_LIVE`.** In that same conversation, with 24 files in the library and
none attached: *"I do not have that document attached to this conversation, so I cannot answer from
it yet."* No library file was dragged in. Previously every file ever attached stayed an active
retrieval target forever.

**Reload restores state — `PROVEN_LIVE`.** The page half of that defect is fixed and deployed: a
hard refresh mid-job rendered "Rendering pages — page 2 of 14" from a cold load.

**Still not proven, and named as such:** corpus reuse (the corpus is not registered, so the
known-source match path is unexercised); the **image** half of the attachment slice; and
cross-account isolation, which needs a second disposable identity.

---

## Lane `PROVEN_LIVE` 2026-08-30 — Scanned-PDF ingestion

**Every stage worked. Nothing started them on upload.**

The pipeline — classification → rasterisation → OCR → folio reconstruction → validation →
canonical persistence → indexing → retrieval — was built, deployed and genuinely proven. But
`requestProcessing` had exactly **one** caller: the indexer's escalation pass. Upload never asked
for a read. A user who uploaded a scanned PDF saw a stored file, no stages, and nothing to suggest a
step was missing.

The status said `CLOSED` because the live acceptance run reached the pipeline through an index call
— recorded in its own notes as "405ms index call". Every stage *after* the trigger was real. The
trigger was never under test, so a truthful pass certified a path the user cannot reach. It
contradicted the lane's own owner decision: *"Upload returns immediately, the file appears in Files
as 'Reading…'"*.

**Measured before the fix**, on `chat.migrateck.com` with a 4-page derivative of the canonical Creole
fixture (0 extractable characters): file uploaded, appeared, **no processing started**. After a
manual index call the whole pipeline ran — `reading_text` page 1/8 → 3 → 4 → 6 → 7 → `ready` in ~90s,
`readable: true`, `unplacedPages: 0`, `sequenceComplete: true`, 4 indexed chunks, index approved and
searchable. Eight pages from four landscape scans confirms the half-page split.

**The fix:** the upload route now asks the Brain to read each saved PDF. PDFs only, matching the
indexer's rule; the Brain still classifies, so a digital PDF is read with `pdftotext` and never
rasterised. `enqueue` is idempotent, so the escalation pass cannot double-read. A reader outage
never turns a saved upload into a reported failure.

**Deployed and proven.** Consumer release `uploadread-08300728` (rollback `numeric-08290240`); Brain
untouched at `multifact-08292338`. Deployed artifacts md5-matched the local build, and the candidate
was boot-tested on a spare port before the symlink swap.

**Upload-triggered acceptance — no index call anywhere in the run.** Fixtures carry facts invented
for this run, so a correct answer cannot come from general knowledge.

| Check | Result |
|---|---|
| Upload starts the read | PASS — `POST /api/files` only; no index call before readiness |
| Truthful `Reading…` state | PASS — `rendering_pages → reading_text → indexing → ready` |
| Page progress advances | PASS — rendering 5..13 of 14, then reading text 1..14 of 14 |
| Reaches `ready` | PASS — 3-page 11s, 14-page 52s, polling stops |
| Grounded answer from OCR alone | PASS — 738 barrels, 62 centimetres, from a 0-character PDF |
| Provenance | PASS — `(cite: acceptance-scan-9012.pdf:1-5)` + "From your files · pages 1-3" |
| Hard refresh during processing | PASS — reloaded page rendered "Rendering pages — page 2 of 14" |
| Hard refresh after ready | PASS — clean terminal render |
| No duplicate read job | PASS — escalation pass left state `ready`, chunks held at 14 |
| Digital PDF not forced through OCR | PASS — 12-page text PDF ready in <1.2s, never rasterised |
| Cleanup | PASS — 31 → 24 files, no leftover chunks |

**One open observation, cause not established.** Synthetic single-page scans report every page
unplaced, where the canonical Creole book reports none. Retrieval is unaffected — readable, indexed,
correctly cited — and the ordering caveat is stated truthfully. I proposed a folio-parsing cause and
then **disproved it** with a fixture carrying bare printed folios, which still reported all pages
unplaced. The spread-reconstruction explanation remains unverified and is not being asserted.

---

## Lane CLOSED 2026-08-27 — Files & Documents (common text/code)

**Deterministic file attribution is `PROVEN_LIVE`, 5/5.**

The pass ran five controlled turns on production `qwen3:8b`. Every prompt ended with
"Do not mention any filename", so the model was forbidden from citing — and every reply
obeyed. The correct single file was still attributed in all five formats, with message
`fileRefs` matching exactly. Provenance comes from the engine's `grounding` frame, not
from model wording, and that is now demonstrated rather than asserted.

| format | file | anchor | attribution |
|---|---|---|---|
| Markdown | `fixture-runbook.md` | ✅ | ✅ |
| Text | `fixture-notes.txt` | ✅ | ✅ |
| CSV | `fixture-invoices.csv` | ❌ | ✅ |
| JSON | `fixture-config.json` | ✅ | ✅ |
| Code | `fixture-service.ts` | ✅ | ✅ |

🚨 **The run is recorded as 9/10 and has NOT been rewritten to 10/10.** The lane closed
because the failing cell was *classified correctly*, not because it disappeared.

The CSV row failed its anchor, and the layers separate cleanly: correct file attached,
correct chunks reached the model — it reproduced all five rows verbatim including
`EMEA,Q2,9930.25` — correct attribution rendered, and *then* the model picked the wrong
maximum. Rephrasing to compare every value explicitly produced the right answer, so it is
prompt/model-sensitive, not retrieval loss. That is a weakness of `qwen3:8b` on structured
tabular data, tracked separately.

Longer term the fix is not a better prompt: MigraPilot should detect a **deterministic data
operation** and route it to a table/data tool, then let the model explain the result rather
than compute it.

---

## Active lane — PDF/DOCX extraction

**Objective:** finish common file/document behaviour before deeper capabilities.

**Last proven milestone:** all five common formats (TXT, MD, CSV, JSON, code) grounded live;
historical file cards render immediately *and* after reload; deleting a file preserves history and
stops grounding.

**Live:** consumer `citations-bc990598` · brain `citations-bc990598`

🚨 **BLOCKED — GPU VRAM contention, not a fault.** ComfyUI holds ~21.5 GB of the workstation's 24 GB
RTX 3090, leaving ~3 GB. `qwen3:8b` needs ~6 GB and fails with HTTP 500 after ~5 minutes; a 1.5 B model
still works. **MigraPilot chat and MigraPilot image generation contend for the same card** — this is an
owner decision about GPU sharing, not something to fix in code.
**Rollback:** consumer `filecard2-` → `filecard-` → `docrefusal-` → `refusalpersist-` → `bc99059`

**Next acceptance test:** citation consistency across TXT/MD/CSV/JSON/code — is the missing citation
on Markdown model variance or a deterministic presentation bug?

**Not yet:** PDF/DOCX extraction · Live Source Intelligence · any search vendor · deleting local
media fallback copies.

---

## Capability status

**PROVEN_LIVE** — Media Library · canonical object-storage media writes · Helsinki replica ·
media monitoring/ILM/restore · image generation persistence · deterministic glyphs · conversation
rename · anonymous→authenticated continuity · image attachment history · follow-up image context ·
image-context isolation · truthful image-editing refusal · refusal persistence + telemetry ·
TXT/MD/CSV/JSON/code grounding · historical file cards · truthful "no document attached" refusal ·
deletion preserves history

**STABILIZATION** — MediaStorage local fallback: **7 clean days required**, started 2026-08-26.
🚨 Run `migra-media-faultwindow open` before testing an alert, or a deliberate fault resets the window.

**PAUSED_CHECKPOINTED** — Live Source Intelligence. Foundation, qualification battery, vendor legal
review and source-family map are done. Resume **only** after this lane is stable, and resume with
the free/direct-source investigation — **not** with paid provider integration.

**HONESTLY_UNAVAILABLE** — PDF · DOCX/XLSX/PPTX · ZIP · existing-image editing · general web search ·
deep research · agents · scheduled automation · full Projects.

**SECURITY_HARDENING** — separate Hetzner project for DR credential isolation. Needs a console action
from Bonex. **Not a product blocker.**

---

## Open defects

| Defect | Effort | Status |
|---|---|---|
| CSV quantitative reasoning — `qwen3:8b` | MEDIUM | **Open.** Model-quality item, not a document-pipeline defect. |
| GPU contention starves the chat lane | MEDIUM | Blocks live acceptance. **Environmental, not a product defect** — see below. |
| Index reported `approved` while holding zero chunks | MEDIUM | Seen once, **not reproduced**. Told the user a real file had "no readable content". |
| Vision turn held 240s and returned nothing | MEDIUM | Operational target, not reproducible |


### GPU contention — the measured facts

The RTX 3090 reads **23,723 / 24,576 MiB and 100% utilisation** while ComfyUI runs a job.
Under that load every grounded chat turn ends in "The engine could not complete the request"
after ~240s (the Brain-call timeout).

Three things rule out the explanations I reached for first:

- **Not a model-load failure.** `qwen3:8b` was already **resident at 11.5 GB** when the turns failed.
- **Not model size.** Substituting the smaller `qwen2.5vl:7b` failed identically.
- **Not MigraPilot.** A direct `/api/generate` probe for `"Reply with exactly the word: READY"`
  hung past **600s**, upstream of the product entirely.

So the variable is **compute**, not just memory headroom, and the honest description is
unarbitrated GPU sharing between image generation and chat on one card.

Two earlier claims of mine were wrong and are corrected here: there is **one** ComfyUI
(launcher 42312, worker 23820, Tailscale bridge 41308 — nothing redundant), and stopping it is
**not** a cheap unblock, because it was **mid-render**. Killing it would have destroyed in-flight
owner work, so the chat lane waits for the queue to drain instead.

---

## Drift control — conclusions that were overturned

Kept so they are not re-derived, and so the pattern stays visible.

- **MinIO on the OS disk** → wrong; it has a dedicated 200 GB volume. I measured `/` instead of its configured volume.
- **No off-host backup** → wrong; a daily encrypted restic backup to Hetzner already existed, with a weekly restore drill.
- **Follow-up image context broken** → wrong; the trace said `dropped:1` because I had deleted that artifact minutes earlier.
- **PDF rejection is a bug** → wrong; it is a deliberate refusal, and the work is building extraction.
- **Weekly backups / SQLite in production / green hook means green build** → all wrong, all corrected.

The recurring shape: **a narrow, explained failure inflated into a broad claim about the architecture.**
Read the telemetry that separates *attempted* from *delivered* before concluding a capability is missing.

---

## Backlog

**Easy / next** — citation consistency.

**Medium** — PDF extraction (⚠️ verify runtime/library compatibility on VM111 first; "pure-JS required"
is an **unverified** assumption) · DOCX · XLSX/PPTX · ZIP · bounded vision timeout.

**Deep** — Live Source Intelligence · image editing · connected apps · scheduled tasks · Projects ·
agents · deep research.

---

## Cost

**No recurring paid dependency is in the architecture.** Hetzner Object Storage is already owned and
in use. All six retrieval vendors are `needs_approval`; none has credentials.
