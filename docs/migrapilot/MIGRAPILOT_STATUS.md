# MigraPilot — Master Status

**`MIGRAPILOT_STATUS.json` is canonical.** This page is the human-readable summary of it.
Both are updated together, on every material change.

Why this exists: work kept discovering something, moving three lanes away, and then having to
reconstruct what was finished — or why a decision was made — from conversation history. Every agent
(Claude, Engineer, MigraPilot) reads this instead.

_Last updated: 2026-09-01_

> ⚠️ `CLAUDE.md` and `AGENTS.md` are **gitignored** in this repository, so the pointers added there are
> local only. This file and its JSON are the tracked copies — link to `docs/migrapilot/` from any new
> instruction file rather than relying on a root-level one to travel.

---

## Lane 2026-09-01 — An attached mockup can be BUILT, not only described

`IMPLEMENTED_NEEDS_LIVE_PROOF`. The Brain path is proven; the extension UX gate is not yet run.
Owner ruling 2026-09-01: the synthetic `8317` badge is strong evidence vision truly read the image,
but it does not replace attaching a real mockup in VS Code and inspecting the workspace change.

Images used to be routed away from the workspace agent because the agent loop has no
vision. That branch was correct and also terminal: sight and tools sat on opposite sides of it, so
"build this mockup" could only ever produce prose. **The capability was not missing — it was
unreachable.**

The governed vision model now reads the image once into a literal spec, and the agent builds from
that text with every tool it already had. Neither side gains the other's capability. The read is a
registered dispatch site (`design_read`), so an interrupted read is recorded as interrupted, and an
empty read deliberately does *not* enter the agent — that would be building blind.

**Proven live, not inferred:** a real PNG mockup through the production Brain routed to
`qwen2.5vl:7b` and read back every element including a small `8317` badge planted to catch a
plausible guess. The derived spec *alone, with no image*, then rebuilt all 9 elements as real HTML
with working inputs and a button, rendering with the badge in its mockup position.

**Two honest limits.** Layout fidelity is the coding model's: the sidebar rebuilt as a stacked
full-width block, not a left column. And a single vision read is unreliable — see the omission
defect below. Requires `migrapilot.enableWorkspaceAgent = true` (off by default).

### What measurement changed

A first read scored 8/9 and one tightened prompt scored 9/9 — which looked like a fix. Replicating
disproved it: the next run scored **3/9**. Across eight runs the same mockup returned the full set
five times and dropped whole regions in the rest, at essentially unchanged output length. That is
omission, not truncation, and the chat path exposes no temperature or seed to turn it down. A second
pass now asks the model what its *own* transcription is missing; across six runs the worst case
improved from 3/9 to 8/9 with no region dropped. Mitigated, not eliminated.

## Deploy 2026-09-01 — governance readiness, and a boot test that proved less than claimed

Brain release `gov-09012017` is live on VM111 (rollback `vision-09011820`). Production reports
`governance: ready`, `persistence: ready`, schema 24, `migrationState: current`.

Two corrections went into the JSON's drift control:

- **Phase 8 was not blocked.** Production already enforces a governed vision decision
  (`vision.general` → `qwen2.5vl:7b` against an exact digest). An earlier probe seemed to show a
  fail-closed `null` only because it read keys the route does not emit. The registry was right; the
  probe was wrong.
- **Spare-port boot tests never loaded the production environment.** `/etc/migrapilot/*.env` is
  root-only, so sourcing it as the service user read nothing, and older builds silently fell back to
  SQLite — so the test passed while proving almost nothing. The new fail-closed persistence rule is
  what exposed it, by refusing to start. Releases now swap through systemd, which reads the env as
  root, with a named rollback target.

**Still blocked:** Phase 3 needs the db name and role from the operator, and the owner's constraint
is that Phase 3 precedes any exposure change (`tailscale serve` for target A).

---

## Phase 3 MEASURED 2026-09-01 — the Brain's database and role

Measured with read-only `pg_catalog` queries on db-core, authorized by the owner. No env file was
read, no credential was read, nothing was written.

```text
Host:        100.77.51.91   (db-core; LAN 10.10.0.6 — same machine, confirmed)
Port:        5432
Database:    migrapilot_brain
Role:        migrapilot_brain
Persistence: postgres
Version:     PostgreSQL 16.15
```

This is **measured, not recorded**: `pg_stat_activity` showed one live session on `migrapilot_brain`
as `migrapilot_brain` from `100.95.14.29`, which is `migrapilot-app-core` (VM111, the Brain host).
That is the Brain's own connection.

### The ownership boundary — dedicated, but not least-privilege

Confirmed good:

- Dedicated database, **owned by its own role** (`migrapilot_brain`).
- **PUBLIC revoked** on it — `datacl` is `migrapilot_brain=CTc/migrapilot_brain`.
- The role has **no memberships**, is not `postgres`, and is not a shared application role.
- `rolsuper`, `rolcreatedb`, `rolreplication`, `rolbypassrls` are all false.

Two deviations from `POSTGRES_CUTOVER_ACCEPTANCE.md`:

1. **`rolcreaterole` is TRUE**, where the spec says `NOCREATEROLE`. On PostgreSQL 16 a CREATEROLE role
   may only administer roles it created, so this is *not* the pre-16 escalate-to-any-role hole — but
   it is not least privilege and not what the spec says. One line fixes it, with no functional impact:
   the Brain migrates schema inside its own database and never creates roles.
2. **The pg_hba restriction in that document does not exist.** There is no rule naming the brain
   database or role. Access comes from two catch-alls: `host all all 100.64.0.0/10` (the whole
   tailnet) and `host all all 10.10.0.0/24`. Password auth still applies, so possession of the DSN is
   the real boundary — but the network boundary is far broader than documented.

### Cross-database reach — a metadata surface, not a data surface

The role can `CONNECT` to 22 other databases because those leave the default PUBLIC CONNECT in place.
Measured impact is zero readable application tables in `migrapay_billing`, `migrapanel`,
`migracredit` and `migrapilot`. This is a server-wide default affecting every role, not something the
Brain introduced.

> An initial count of "188 readable tables" in three different databases was a **measurement
> artifact** — identical in all three because it was counting `pg_catalog`/`information_schema`
> grants. Restricting to application schemas gave 0.

**A is HELD.** `tailscale serve` has not been run.

---

## Target A ACTIVATED 2026-09-01 — the extension is on the governed Brain

```text
https://migrapilot-app-core.tail9e1625.ts.net  ->  proxy http://127.0.0.1:3988
```

The Brain's binding is **unchanged** at `127.0.0.1:3988`. Serve terminates TLS and proxies to it, so
nothing new binds a public interface.

Hardening landed first: `ALTER ROLE migrapilot_brain NOCREATEROLE` is applied and verified read-only
(`super=f, createdb=f, createrole=f, canlogin=t, replication=f, bypassrls=f`). The role now matches
`POSTGRES_CUTOVER_ACCEPTANCE.md` exactly, and a durable write plus read-back through the new endpoint
confirmed nothing broke.

Proven over HTTPS: health (`governance: ready`, schema 24); a durable conversation write and
read-back; a chat turn routed to `qwen3:8b` returning the exact sentinel; and an image turn routed to
the governed `qwen2.5vl:7b`, reading the planted `8317`.

The SSH tunnel is retired — killed **by pid, not by pattern** — and `127.0.0.1:13988` now refuses
connections, so falling back to it silently is impossible.

### Repointing exposed a real defect

Both scopes were wrong in different ways: the workspace file pointed at the tunnel, and **machine
settings still pointed at `http://127.0.0.1:3988` — the old local dev Brain**, the very second-Brain
hazard this lane exists to remove.

Worse, `BrainLifecycle.ensureRunning` had **no loopback guard**. With auto-start on, an unreachable
*remote* endpoint took the same branch as a missing *local* one and spawned a brain from
`apps/brain-service`. A second Brain runs against different persistence, so the product would look
healthy while answering from an ungoverned store — the forbidden fallback wearing a different hat.

Fixed with a distinct `remote` result (not `disabled`, which is a different fact), a status-bar
message that is actually true, and an `isLocalBrainUrl` that **parses** rather than substring-matches,
so `localhost.evil.example` is not loopback. Six regression tests; suite **861/861**.

### Open for the owner

- `tailscale serve` authenticates by **tailnet membership, not per user**, and `/api/ai/chat` still
  takes no per-request token. Consistent with `pg_hba` (which already trusts the whole tailnet) but
  weaker than per-user auth. A Tailscale ACL on the served port is the mechanism if you want tighter.
- The **10-item acceptance list through the extension UI is not done**. Everything above was measured
  over the wire. The extension is repackaged and reinstalled; the UI gate needs a window reload.

---

## Tailnet identity gate — PROVEN_LIVE 2026-09-01

Serving the Brain over the tailnet made it reachable by **everything** on the tailnet. Measured, not
theorised: `mail-core` and `voip-core` — a mail server and a VoIP box — both returned `200` on
`/health`.

**An ACL could not fix this, and saying it could was wrong.** Tailscale's policy model is default-deny
with explicit *accepts* and no deny rule, so a permissive tailnet cannot have one port carved out of
it. Tightening would mean re-enumerating every rule across 8+ production servers, with real lockout
risk. That earlier recommendation is withdrawn.

The boundary was expressible in the application instead. Three caller shapes were measured against the
live endpoint **before any rule was written**:

| Caller | identity | `x-forwarded-for` |
|---|---|---|
| user-owned node via Serve | **present** | set |
| tagged server via Serve | absent | set |
| on-host loopback | absent | **absent** |

So `x-forwarded-for` answers *"did this come through Serve"* and the identity headers answer *"is
there a person behind it"*. Identity-less requests are refused only when proxied, which leaves on-host
monitoring and local services untouched.

**Spoofing was tested, not assumed.** `mail-core` sending its own `Tailscale-User-Login` arrived with
no identity at all — Serve overrides client-supplied identity headers. A proxied request also cannot
hide by omitting `x-forwarded-for`, because Serve sets it. The remaining trust condition — loopback
binding, Serve as the only route in — is stated in code at the point of use.

Verified live: workstation gets `200` and a real chat (`GATE-OK`) plus a governed vision turn (`8317`)
and a durable write; `mail-core` and `voip-core` both get **403 `TAILNET_IDENTITY_REQUIRED`**; on-host
loopback still `200`. Suite **2119/2119**.

Escape hatches: `MIGRAPILOT_BRAIN_REQUIRE_TAILNET_IDENTITY=0` disables enforcement without a redeploy;
`MIGRAPILOT_BRAIN_ALLOWED_LOGINS` narrows to named users (empty means *any tailnet user*, not nobody);
`/health` and `/api/identity/whoami` stay exempt.

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
