# MigraPilot — Master Status

**`MIGRAPILOT_STATUS.json` is canonical.** This page is the human-readable summary of it.
Both are updated together, on every material change.

Why this exists: work kept discovering something, moving three lanes away, and then having to
reconstruct what was finished — or why a decision was made — from conversation history. Every agent
(Claude, Engineer, MigraPilot) reads this instead.

_Last updated: 2026-09-07_

> ⚠️ `CLAUDE.md` and `AGENTS.md` are **gitignored** in this repository, so the pointers added there are
> local only. This file and its JSON are the tracked copies — link to `docs/migrapilot/` from any new
> instruction file rather than relying on a root-level one to travel.

---

## Lane 2026-09-04 — Structured-data acceptance matrix: 10 live cases green

"CSV works" is not a status, so this was built as a matrix instead. Every case run through the real
product, each in a fresh conversation with the file attached through the composer's own picker.

| Case | Live result |
|---|---|
| sum | 474,000 (owner-verified) |
| average | $67,714.29 — over the 7 rows that had a value, not 9 |
| minimum | −$3,750, West, OrderID 004824 |
| maximum | $156,250, East |
| count | 9 rows |
| group-by | North 165,000 · South 156,500 · East 156,250 · West −3,750 |
| identifier refusal | 5 independent runs, no identifier total in any evidence |
| percentages | average Margin **12.75%** |
| currency / negatives / missing values | `$`, thousands separators, `(3,750)` → −3750, blanks and `n/a` absent not zero |
| large table | 5,000 rows → **24,112,952**, matching an independently computed truth |
| multiple candidates | asks which column was meant, naming all of them |
| TSV | 474,000 |
| ambiguous question | clarification, not a guess |

### Four defects, found by building the matrix rather than by reading the code

1. **`count` produced no evidence at all.** It resolved to `count`, then fell through *column*
   selection — several columns were quantitative, none was named — so the one operation impossible to
   get wrong was answered from raw text. Counting rows needs no value column.
2. **Percentages reached the model as bare fractions.** `average of "Margin": 0.1275`, about a file
   that says 12.75%. Stored as a fraction so averaging is correct; the evidence has to dress it back up.
3. 🚨 **An amount under one was read as a code.** The leading-zero identifier test stripped `.` and `,`
   first, so `0.00` became `000` and matched. Every amount under a pound — and zero itself — was an
   "identifier". That put a real price column at 8/9 = 88.9%, under the bar, and **disqualified it
   silently**. Now anchored to all-digits: `007` is a code, `0.50` is money.
4. **Ambiguity went quiet.** *"What is the total?"* over Revenue **and** Cost correctly declined to
   compute — and the model then footed the table itself and answered $60,000. Right, on three rows;
   the original defect on five thousand. The reasoning that made a refusal *speak* had not been
   applied to this branch.

### Also found, and not in this lane

With **two approved indexes in one owner scope**, every grounded question is refused with "Your
indexed documents do not cover that" even though the file is indexed and approved. Self-inflicted
here — changing the upload root mid-session — but a user whose root changes in a migration or a
redeploy lands in the same state, and the refusal is indistinguishable from "not indexed". Recorded
as an open grounding/retrieval defect, not fixed in this lane.

**XLSX stays closed** until implemented — but the substrate it would reuse is now proven, which was
the point of doing this first.

---

## Lane 2026-09-04 — Gap #7 Revenue regression: OWNER-VERIFIED PASS, closed

The owner read the product's own answer — *"The total Revenue in the file is $474,000"*, naming the
**Revenue** column and citing the uploaded file — in MigraPilot itself, not in a harness assertion.

| Acceptance point | Result |
|---|---|
| Revenue-total regression | **USER-VERIFIED PASS** |
| Known bad result `473,250` | **not reproduced** |
| Wrong-column substitution | **not observed** |
| File grounding / citation in UI | **present** |
| Final Revenue result | **$474,000** |
| This acceptance case | **CLOSED** |

### The identifier refusal, validated on its own

The owner asked for the second safety property to be proven independently, and was right to. The
first ZIP check ran as a *follow-up turn in the same conversation* as the Revenue answer — the model
had already been shown what a real computed total looked like. That is help the test should not have
had.

Re-run as **five fresh conversations with the identifier question asked first**: three identical ZIP
asks (to separate the property from model variance), one OrderID ask, and one deliberately pressing
phrasing — *"Add up all the ZipCode values and give me the number."*

- **Model-visible: 5/5 refused.** No run produced `570,236` or `43,425`.
- **At the transport boundary: 5/5.** Every prompt carried a refusal naming the column, and **zero
  prompts contained an identifier total**. That is the stronger claim, because it does not depend on
  the model behaving: it cannot repeat a number it was never given.

### What is still open, deliberately

Only `sum` has been exercised live; average/min/max/count/group-by are unit-tested only. Only CSV.
One small file. A local Brain rather than production — forced, because the consumer hands the Brain a
filesystem path to index and VM111 cannot see this machine. The broader numeric-analysis feature
stays **open** on those grounds; the Revenue defect itself has earned its closure.

---

## Lane 2026-09-04 — Gap #7 measured through the real path: NOT closed

The spreadsheet arithmetic was never the problem. **Column selection is**, and the measurement found
it in the first run.

**The run.** A 9-row CSV — `Region, OrderID, ZipCode, Revenue` — submitted through the composer's own
picker by a signed-in user, indexed, then asked *"What is the total Revenue in this file?"*. True
total: **474,000**.

**What the deterministic layer handed the model:**

```
[Computed directly from q3-regional-revenue.csv by MigraPilot. These figures are exact
arithmetic over the parsed file, not estimates. Use them verbatim and do not
recalculate them:]
sum of "ZipCode": 570,236
  (9 rows used)
```

It computed the **ZIP code** column. The model, given evidence that did not answer the question,
footed the table itself and replied **"The total Revenue in this file is $367,500."** — wrong, and
arrived at by exactly the mechanism this module exists to eliminate.

**Root cause — two rules meeting.** A column counts as quantitative only when ≥90% of its non-blank
cells are quantities. One `n/a` among nine rows put Revenue at **7/8 = 87.5%**, so the actual money
column was disqualified. `chooseValueColumn` then fell back from "the named column" to "the only
quantitative column" — **ZipCode**, because plain 5-digit ZIPs are not caught by the leading-zero
identifier rule. The substitution is silent, and the evidence block then asserts authority over it.

🚨 **That is worse than the defect it replaced.** The module's own docblock promises "a ZIP code, an
order id … must never be summed". A ZIP code was summed and offered as the answer about revenue —
with a sentence telling the model not to check it.

**The arithmetic itself is sound.** Change one character — the `n/a` to an empty cell — and Revenue
clears the threshold, and the whole path is correct end to end: evidence `sum of "Revenue": 474,000
(7 rows used, 2 blank)`, answer *"The total Revenue in this file is $474,000"*, `outcome=ok`, and the
durable record still holds that sentence after a reload.

**Also found:** for a signed-out visitor the composer offers **"Files & documents"** fully enabled,
while every document operation behind it is authenticated-only. The upload 401s and the chip offers a
**Retry** that can never succeed. Same dead-control defect as Listen, one row below the images entry
that *was* fixed.

**Not fixed here — this was a measurement task.** The direction that keeps the guarantee: when a
*named* column is disqualified, emit no evidence at all rather than computing a different column.
Silence beats a confident wrong figure; the substitution is the part that has to go.

---

## Lane 2026-09-04 — The consumer could not build from a clean clone either

Found while opening chat gap #7, and it outranked the gap. `RESOLVED`.

The spreadsheet analysis the gap asks for **already existed**: five careful modules that parse a
CSV, classify each cell, refuse to sum anything merely numeric-shaped, compute the figure and hand
it to the model as evidence with full provenance. Already wired into the chat stream route. Already
covered by 22 passing tests. **And untracked** — along with `turnGrounding.ts`, which the same
committed route imports.

**Measured, not inferred.** Moving aside exactly the eight untracked source files a clean checkout
would lack and running `tsc` produced two `TS2307` errors on the committed route. The consumer could
not be built from its own repository; production ran a bundle whose source lived on one workstation's
disk.

🚨 **The brain-service guard added days earlier for the identical defect would not have caught this
one.** It scans relative specifiers only, and this app imports itself through the `@/*` alias. A
guard copied without checking which specifier shapes the package actually uses is a guard that passes
while the build is broken.

So the consumer now has its own `repositoryIntegrity.test.ts`: every source file tracked, and no
tracked file importing a missing or untracked target — with alias resolution. Proven by reintroducing
the defect: un-tracking the tables module fails both checks and names the exact edge.

One detail worth keeping: the guard flagged **its own fixtures** on the first run. The wrong fix was
an exemption for the file that defines the rule; the right one was to make every fixture name a real
module, so the gate stays fully self-applying.

**Gate:** typecheck 0 · 795/795 tests · `next build` green · bundle scan PASS.

### 🚨 Correction, same session: I called this resolved before verifying it

Committing the untracked modules closed one half. Checking a **real clean worktree** — which should
have come before the claim, not after — showed `HEAD` still fails to typecheck, for two further
reasons:

- **Pre-existing, not mine.** Commit `125a7f13` (the file-attachment lane) committed a `Composer.tsx`
  that passes `onChooseAnother` to `AttachmentChips`, whose matching change is still uncommitted.
- **Mine.** I committed `uploadCeiling.test.ts`, which imports three symbols that exist only in that
  same lane's uncommitted `capability.ts` and `outcome.ts`. Tracking it made the break worse. It is
  un-tracked again and belongs with the work it depends on.

**The gate has a limit worth stating:** it checks that files are tracked and that imports resolve to
tracked *files*. It does not check that the needed *exports* exist in the committed content — which is
exactly how my own mistake slipped past it. The stronger gate is a typecheck in a clean worktree, and
it cannot be added green until the attachment lane's ~15 modified files land.

A third error — `Logo.tsx` failing to resolve a `.png` — was **not** a defect: `next-env.d.ts` is
Next-generated and deliberately untracked, so a worktree that has never been built lacks the image
module declaration. Checked before reporting it.

**Gap #7 itself is a measurement, not a build.** The arithmetic exists and is wired; what nobody has
shown is that a real CSV, attached in the real UI, produces the right total.

---

## Lane 2026-09-04 — Ask again, without pretending anything was replaced

Gap #5, shipped as the honest subset. `LIVE` for what was built; the rest is **blocked on Brain
storage** and is now tracked as its own item.

**The constraint decided the feature, and it was measured rather than assumed.** The Brain exposes
create-conversation, append-message, list-messages and delete-the-whole-thing — and nothing else. No
remove-one-message, no truncate-after, no parent or branch column anywhere in the routes or the
Postgres repos. So "regenerate" and "edit" as other chat products mean them — the old answer
disappears behind a *2 of 2* arrow — are capabilities this product does not have. Building them
anyway would give a transcript that rearranges itself on reload: one answer in the browser, two in
the durable record, and no way for the reader to know which they were looking at.

**What shipped is what is true.** *Try again* on the last answer asks the same question again,
carrying the same attachments, images and Migra family. *Edit and ask again* on any question loads it
back into a focused composer to be rewritten. Both append, both are visible, and the labels are the
honesty — a test fails if the word "Regenerate" or a bare "Edit" appears.

Offered on the last answer only: a repeat appends to the bottom, so repeating an older question would
drop its answer underneath a conversation that has moved past it. Never offered mid-stream — that
would be a second door into the defect Stop exists to prevent.

**Measured before building:** does the same prompt even produce a different answer? Three runs of one
short prompt through the production Brain gave two distinct answers, so the control is real rather
than decorative. That is not a rate — n=3.

**Gate:** typecheck 0 · 787/787 tests (from 768) · `next build` green · **14/14 live checks**,
including the one that matters most: after a reload the screen and the durable record show the same
six messages.

### What is still missing, and where it belongs

Branch semantics. Replacing an answer or forking a thread needs a message model the Brain does not
have — either delete/truncate-after-a-message, or a parent/branch reference plus a rule for which
branch is live. That is brain-service plus a PostgreSQL migration plus a deploy, so it could not be
proven live from here and was not started. It is now ranked separately as a **Brain** slice, not a
chat one.

---

## Lane 2026-09-04 — The voices existed; nothing could choose one, and Listen was dead

`LIVE`. Gap #4 of the Chat Capability Matrix, plus a defect found while opening it.

**The gap.** The speech runtime has offered Warm, Bright and Steady all along and reported all
three on every capability probe. No control could pick one, so every answer was read in the engine
default and two voices were inventory. There is now a picker beside Listen — offered only where
speech works, and only when the engine offers more than one voice. The voices and the default come
FROM THE ENGINE; nothing is hardcoded in the browser, and a test asserts it. One choice for the
whole screen, remembered per device, like the Migra family selector.

🚨 **The defect that was there first: Listen was a dead control for every signed-out visitor.**
`synthesisCapability` and `synthesizeSpeech` are absent from the operation audience table, so they
took the closed-by-default fallback and were refused — and the route collapsed every failure into
"The voice service could not be reached." A live button on every answer, failing on click, blaming
our own infrastructure for a decision about accounts. **This is the same defect that table already
documents twice** — for rename/delete, then for the thumbs — live again in a third place. The
refusal and the outage are now separate facts: `requiresAccount` on the probe, `403 requires_account`
instead of `503`, and the control renders disabled with the true sentence in both its tooltip and
its aria-label. A real engine fault still reads as an outage.

🚨 **Changing the voice had to throw away the audio synthesised in the old one.** Replay reuses the
cached clip rather than re-synthesising, so without that the picker fails in the most convincing way
there is: select Bright, press Listen, hear Warm — and no error, because nothing failed.

### Owner ruling 2026-09-04 — speech stays signed-in only

Asked because it had never been decided: those operations were simply never listed, so the audience
was a fallback rather than a choice. Chat is already open to visitors on the same GPU, and the
table's own principle ("the boundary is the SCOPE, not the sign-in state") argued for opening it —
but there is an open GPU-contention defect and public TTS is uncapped compute. **Kept closed.**
Opening it is a one-line change; a capped version is its own slice.

**Gate:** typecheck 0 · 768/768 tests (from 737) · `next build` green · live: 6/6 signed-out checks
and 9/9 picker checks against the production speech runtime. The route had no tests at all before
this; it has 11 now. Next chat gap: #5, regenerate + edit/resend.

---

## Lane 2026-09-03 — A running answer can be stopped

`LIVE`. Gap #3 of the Chat Capability Matrix ("NO STOP: a running turn cannot be stopped; the Brain
aborts only on browser disconnect") is closed, proven end to end against the production Brain.

The send button **becomes** Stop while a turn streams — one slot, two states — and Enter obeys the
same rule. That is not only how Stop got a home: rendering Send beside a running stream is what let a
second turn be fired into a conversation already receiving one.

**The abort travels.** The browser drops the request, the stream route's `cancel()` returns the Brain
generator, and the generator's `finally` releases the upstream reader. The server trace for a stopped
turn reads `outcome: "cancelled"`. A Stop that only cleared the spinner would leave a graphics card
producing an answer nobody would ever read.

🚨 **The load-bearing mechanism is the REQUEST SIGNAL, not the response cancel** — established by
writing the regression test the wrong way round first. Cancelling only the response stream calls
`cancel()`, which awaits `frames.return()`; the generator is suspended on an upstream `read()` that a
still-generating model never settles, so the return queues behind it and nothing unwinds. Deleting
`signal: request.signal` from the route makes that test hang, which is how we know.

**What the user is left holding.** Text they already read is kept and labelled — "You stopped this
answer. It was not finished, so it was not saved." — in neutral grey, because a stop is not a fault.
A turn stopped before any output keeps nothing and says so. An image-only turn counts as an answer,
the same rule as the delivery path. Verified by reload: the question survives, the partial does not,
exactly as the label promises.

### The defect the live run found in the fix itself

The first implementation **sent a message when Stop was clicked** — two requests for one click,
reproduced deterministically in a real browser. `type="button"` was already there and did not save
it: `onStop` aborts, the rejection lands on the microtask checkpoint at the end of the click handler,
React clears `pending` and re-renders, and because both branches render a `<button>` in the same
position React **patched the clicked node** to `type="submit"` before the browser ran the click's
default action. Fixed with `preventDefault()` and distinct React keys so the node is replaced rather
than retyped; both defences are mutation-tested. Structural reasoning would not have found this — the
browser did.

**Gate:** typecheck 0 · 737/737 tests (from 709) · `next build` green · client-bundle scan PASS ·
13/13 live browser checks. Not committed, not deployed. Next chat gap: #4, the voice picker.

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

---

## 2026-09-06 — Chat lanes closed

Production release **`refusal-mixture-0906`** (commit `d5459a9e`, buildId `X8fJP-3lZN87oZ6Natk6v`),
verified from the public `/api/version` independently of the deploy. Rollback target
`refusal-cause-0906`.

| lane | state |
|---|---|
| Model picker | **USER-VERIFIED PASS** |
| Lane B — XLSX structured analysis | **USER-VERIFIED GREEN** |
| Lane C — refusal truthfulness | **USER-VERIFIED GREEN** |
| Lane A — Migra Core | **CLOSED AS CORRECTLY BLOCKED** — not pending |
| Multilingual qualification floor | OPEN governance review |
| Studio framing A/B | blocked — ComfyUI not running on the Windows host |

### Lane A is blocked correctly, and that is a finished state

It was recorded as waiting on an operator signature. It was not. Migra Core said *"no approved model
for chat.general"* because **there was no evidence** — the suite existed in full (30 cases,
per-dimension floors, a threshold committed before any candidate ran) and `runChatGeneralSuite` had
no caller. Nothing had ever been measured. The staged evidence on the Brain host is
`vision-understanding-v1` for a capability that is already approved.

The suite was given its missing entry point and run. Both candidates were **refused**:

| candidate | overall | qualifies | failed dimension | `hall-fake-paper` |
|---|---|---|---|---|
| `qwen3:8b` | 0.931 | **false** | hallucination_resistance | 1/3 |
| `qwen3:14b` | 0.966 | **false** | hallucination_resistance | **0/3** |

Negative controls 3/3 in both runs. The grader was checked against the raw answers before
concluding — a case that defeats every candidate is when to suspect the instrument, and here the
instrument is right: `qwen3:14b` fabricated an invented 2019 paper outright in all three runs and
invented a provenance that does not exist.

**The larger model scores higher overall and is strictly worse at the thing that matters most.**

> 🚨 **Overall score never overrides a dimension floor. A high average never excuses a critical
> capability hole.**

Operator approval is **NOT PERMITTED by current evidence**. Migra Core stays unavailable and the
picker reports that truthfully. Evidence packages are committed in full at
`apps/brain-service/evidence/chat-general/` so the verdict can be re-derived by someone else.

### Two governance items left open, deliberately

- **Multilingual floor.** `multilingual` scored 0.50 on `qwen3:8b` and did **not** fail its floor;
  the Creole answer was *"Porte-Prince se kapital peyi Ayiti"* (the capital is **Pòtoprens**). The
  floor appears more lenient than the flagship Creole promise. **Do not change it retroactively
  against these runs** — create a new threshold version with explicit rationale and evaluate future
  candidates under it.
- **`deepseek-r1:32b` was not tested.** Stepping through candidates after seeing failures is
  candidate-shopping around the gate. If it is evaluated later it must be a **new pre-registered
  campaign**, with the candidate chosen for an architectural reason before results are seen — never
  as a rescue attempt for this lane.

### Defect list reconciled, 2026-09-06

Three entries described behaviour that this session fixed and Bonex verified in production. A defect
list that outlives its defects is the same failure this file exists to prevent, so they were moved to
`resolvedDefects` **with their evidence**, not just deleted:

| defect | evidence |
|---|---|
| `identifier-refusal-failed-in-the-real-product` | `analysisMatrix.test.ts` asserts 132,737 can never appear for any spelling of ZipCode; production summary retest reported ZipCode/ORDERID/Booked as identifiers/dates, not totalled |
| `table-evidence-answers-with-the-wrong-column` | a named column is never silently swapped — it refuses and says why; pinned by `columnSelection.test.ts` |
| `csv-quantitative-reasoning-qwen3-8b` | the figure is computed by the deterministic layer, not selected by the model; production returned Revenue 474,000, Units 175, Margin 17.6% |

`gpu-contention-starves-chat` **stays open** — it is environmental, not a code defect, and it was
**re-triggered on 2026-09-06** by running the MigraAI Studio framing A/B on this workstation.
ComfyUI held ~16 GB of the 3090 that production inference shares, leaving 8 GB: enough for
`qwen3:8b` and `qwen2.5vl:7b`, **not** for `qwen3-coder:30b` (migra-forge).

> 🚨 Killing the ComfyUI Desktop shell does **not** release the VRAM — its python server is a
> separate process and keeps serving on :8188. Both must be stopped.

**Standing implication: Studio rendering and MigraPilot production inference must not share this GPU
concurrently.**

---

## 2026-09-07 — User-tool framework, and one rename authority

> ⭐ **ONE CAPABILITY, ONE AUTHORITY, MANY CLIENTS.**
> Shared semantics, client-specific presentation.
> **No client gets its own business logic or a private bypass around a canonical capability.**

| claim | state |
|---|---|
| Platform-wide rename governance | **ENFORCED** |
| Consumer rename flow | **READY FOR USER TEST** — not closed until Bonex runs it signed in |

Two direct-mutation verbs are withdrawn (410, each naming its replacement):
`PATCH /api/conversations/:id` and `PATCH /api/ai/conversations/:id`. Both the consumer and the
VS Code extension now call the same `propose → approve/decline → dispatch` contract. Restoring
either verb fails exactly the regressions written to guard it.

**A correction I owe the record.** I reported that the VS Code extension *called* the Brain's PATCH.
It did not — the client method existed with no caller, no contributed command and no webview path.
The bypass was real; the shipping flow I said would break was not, and I had used that claim to argue
for keeping an exception.

**Authorization caveat, unchanged and deliberate.** Workspace-scope recheck at dispatch is proven, and
an approval never becomes delegated authority. Role/entitlement authorization is **not** proven,
because that system does not exist. When it arrives, replace the resolver behind `authorize` — do not
change the consent protocol.

**Before any non-idempotent tool** (send / create / charge / deploy / destructive), durable
backend-enforced idempotency is a hard prerequisite. Rename is safe only because it is naturally
idempotent.

### Engineering invariants added

> **Never terminate a process because it owns a port.** Terminate only a process whose ownership was
> recorded by the current run. If a port is occupied by something else, allocate another port.

> **A successful HTTP response is not evidence that you reached the application you launched.**
> Verify application identity — run id, build id, route fingerprint — before browser evidence counts.

Both came from one incident: port 3399 was held by another session running AnnouPale. It answered
**200** throughout, so some browser runs tested a different product while reporting success — and a
`kill -9` over the port missed their process only because their command used `--port` and the pattern
required `-p`. Enforced by `scripts/assert-rig-identity.js`, which both browser harnesses now call
before clicking anything.

---

## Agreed schedule (Bonex, 2026-09-07) — fixed order

    user acceptance → harness evidence-integrity fix → durable idempotency → spreadsheet quantitative reasoning

No drift to Projects, no higher-risk tools, no Studio detour unless a shared dependency genuinely
blocks Priority A.

**0. User acceptance — IN PROGRESS, and the gate.** The 10-case signed-in rename battery on the local
rig, port 3407. Everything below is frozen until it completes; the rig must stay stable.

> **Interrupted 2026-09-07 by a Chat regression Bonex found during acceptance**, and fixed first:
> cold model startup rendered *"Loading the language model — the first answer after a pause takes
> longer to start."* as an assistant conversation bubble, with a second floating indicator around it.
> **FIXED (`79b0409b`) — READY FOR USER TEST, not done.** It preempted the queue because it is a
> truthfulness defect on Chat, the governing program: accepting a rename battery on a build that
> presents runtime state as MigraPilot's own words would be accepting the wrong thing.
>
> The rig was rebuilt to serve the fix — buildId `LIHliv21952a3JHldzh2L` → `EmWrBUfJwH2HCY24sUObl`.
> The frozen rename **commits** are untouched; only the running build moved. `verify-rename-approval.cjs`
> re-ran green against the new build, and the Brain was neither rebuilt nor faulted.

### What was actually wrong, and why the guard missed it

The earlier fix was correct on the side it was tested on. The string never reached message data, was
never persisted, never survived a reload. It was **rendered** inside `LogoMark` and
`rounded-2xl rounded-tl-md border border-hairline bg-raised … shadow-card` — character for character
the assistant's own bubble. So it arrived wearing MigraPilot's avatar in MigraPilot's bubble.

> **"This is not a message" is a claim about rendered output, not about which variable holds the string.**

The guard could not have caught it: it matched `ChatProvider.tsx` as **text** for the absence of
`paint(detail)` — true the whole time, and irrelevant to what was on screen. That is the keyword-proxy
defect in a test rather than a metric. The deeper cause is that **no chat component had ever been
rendered under `node --test`** — a missing `.png` loader made it impossible, so matching source text
was the only guard available. `test/serverOnlyLoader.mjs` now stubs static assets and `next/image`,
and the suite renders real components and asserts on real markup.

Two surfaces now, never both: a **status row** for the detail (no avatar, no bubble, no timestamp, no
Listen) and the wordless three dots, which keep the bubble because they carry no words to mistake for
an answer. `showsTurnProgress` retires the indicator once the answer starts arriving — `pending` alone
had kept it mounted underneath the streaming bubble for the rest of the turn.

Verified against a **real** cold start: `scripts/verify-cold-start.mjs` evicts the model from Ollama,
drives a signed-in turn through the browser, and reports **INCONCLUSIVE with a non-zero exit** if the
cold-start line was never observed — so a warm model cannot print green.

**1. Harness evidence integrity — first after acceptance.** Not cosmetic debt: a hardcoded
`127.0.0.1:3407` in verification tooling reproduces the exact false-green class already hit when
another session occupied the expected port, so it **outranks feature expansion**.

> Verification harnesses must never assume the application URL, port, PID or service identity. They
> consume the run metadata the launcher produced, and verify build/run identity before collecting
> evidence.

No literal port and no literal fallback · URL from env/config/run metadata · identity verified before
evidence · fail closed on missing or mismatched identity · never find the product by scanning ports ·
recorded-PID ownership preserved · **mutation-tested**, so restoring a hardcoded target breaks the guard.

Neither prohibited discovery mechanism may return: not **assuming a port**, and not **trusting a 200**.
Reachability is not identity — the response that proves a server is listening is the same response
another product would give, which is precisely how the false green happened. A harness that reaches its
target and stops there has confirmed nothing about what answered.

**2. Durable idempotency — the gate before every meaningful mutating tool.** A platform primitive, one
authority, no per-tool copies, keyed on canonical normalized operation identity:

    idempotencyKey + toolId + actor + scope + normalizedInputHash
      → pending | committed | failed_before_dispatch | outcome_unknown
      → durable result / reconciliation record

Until it exists: no Gmail send, no create operations, no deploy, no destructive file actions, no charges.

**3. Spreadsheet quantitative reasoning — the one PARTIAL inside Priority A.**
🚨 Do not stack more XLSX-specific patches. Finish the **shared quantitative substrate** so CSV, TSV
and XLSX all consume the same reasoning/aggregation contract.
