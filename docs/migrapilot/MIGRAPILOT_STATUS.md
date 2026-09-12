# MigraPilot — Master Status

**`MIGRAPILOT_STATUS.json` is canonical.** This page is the human-readable summary of it.
Both are updated together, on every material change.

Why this exists: work kept discovering something, moving three lanes away, and then having to
reconstruct what was finished — or why a decision was made — from conversation history. Every agent
(Claude, Engineer, MigraPilot) reads this instead.

_Last updated: 2026-09-12_

> ⚠️ `CLAUDE.md` and `AGENTS.md` are **gitignored** in this repository, so the pointers added there are
> local only. This file and its JSON are the tracked copies — link to `docs/migrapilot/` from any new
> instruction file rather than relying on a root-level one to travel.

---

## 2026-09-12 — **MigraPilot staging parity**: real inference, real database, real identity

State: **STAGING PARITY READY — GMAIL INTEGRATION PENDING**

Runbook: [`STAGING_ENVIRONMENT.md`](./STAGING_ENVIRONMENT.md). Details in the JSON under
`stagingEnvironment2026_09_12`.

| | Staging | Production |
| --- | --- | --- |
| Release | `3c204aa8` / `staging-3c204aa8`, stamped | `0f494d27` / `chat-platform-rc-0908`, stamped |
| Host | CT101, tailnet `migrapilot-staging-core` `100.83.46.93` | VM111, `100.95.14.29` |
| Inference | `100.86.143.93:11434` over Tailscale | the same endpoint |
| Database | db-core `migrapilot_brain_stage`, PG 16.15 | db-core `migrapilot_brain`, PG 16.15 |
| Node | 22.23.2 | 22.23.2 |

**Chat works end to end.** Typed in the real composer, answered, persisted:
`llama3.1:8b` via the Brain's capability router, 2 conversations and 4 messages durable on
db-core. `/health` reports `gpuCapacity: ready`, `residentModels: ["qwen2.5-coder:14b"]`,
15.2 GB VRAM — a real probe of the workstation GPU across the tailnet.

🚨 **The lesson from the previous state**: `probe()` returns `reachable: true` for a *stub*
provider by definition, so all four profiles reported healthy while nothing could generate.
`gpuCapacity` was the field telling the truth. Never read "providers reachable" as
"inference works".

**Rollback re-proven** after the Tailscale, inference and database moves — both ways, both
services, `/health` 200 throughout. Retention now caps staging at three releases and never
deletes the active one or the rollback target.

**Isolation measured, not assumed**:
`has_database_privilege('migrapilot_brain_stage_app','migrapilot_brain','CONNECT') = FALSE`.

### One blocker, and it is the owner's call

`DEPLOY_HOST=migrapilot-staging-core` now resolves via MagicDNS and Tailscale SSH is enabled
on the node — but the tailnet ACL refuses it: *"tailnet policy does not permit you to SSH to
this node."* **One SSH ACL rule** is all that stands between staging and the real deploy
tooling. It is a security-policy change, so it was not made quietly.

### Also open

- **Model parity unconfirmed.** The profile defaults mirror the *local dev* Brain
  (`qwen2.5-coder:14b`); production's env is root-only and holds secrets, so it was not read.
  The router picked `llama3.1:8b` regardless, so this matters less than it looks — but confirm
  before trusting staging as a behavioural gate.
- Governance unsigned (**production reports the same**), Gmail deliberately unwired, nothing in
  Google Cloud touched.

---

## 🚨 2026-09-10 — OWNER PRODUCT ACCEPTANCE: **FAIL**, diagnosed and fixed

`7251112a` · `3926a9c4` · `75325660`

**No RC freeze. No staging promotion. Gmail connection untouched.** Awaiting owner re-acceptance.

The failing turn is preserved: request `req-1d`, 02:44:49, conversation `conv_pv0jpy0r1qd4a53jrhwb8`,
prompt *"Find the email about containing MIGRA_EMAIL_SENTINEL_0909"*. Both message rows are still in
postgres; every reproduction used separate conversations.

### The trace, from telemetry and the durable record

| Question | Answer |
| --- | --- |
| Selector chose | `migra.email`, `object-of-request`, on the word "email" |
| Repo planning | **No** — `repoPlanning: false`; the index was never consulted |
| `migra.email` executed | **Yes** — `stage=search outcome=ok count=1` |
| Operation | `search`, and nothing else that turn |
| Query sent to Gmail | `migra_email_sentinel_0909` |
| Results | 1 |
| Single-result `readMessage` enrichment | **Did not exist.** It had been deferred as a product decision. It exists now |
| Evidence in the ledger | one `EmailEvidence` — the snippet, `complete: false` |
| Where the sentinel actually is | **Only in the attachments.** Snippet no, subject no, *full body* no (`bodyComplete: true`, 140 chars) |

So your hypothesis was exactly right: **Gmail matched the message because Gmail indexes attachment
content.** The retrieved message never contained the term, so the verifier removed every claim that it
did — correctly. The user was told nothing was found, about a search that had found the right message.

### Why the answer looked broken in two more ways

- **"No workspace content was retrieved in this run"** — `gapStatement()` ends that way when the repo
  ledger is empty. Written when a repository was the only place evidence came from; said to someone
  asking about their mailbox it implies the wrong thing was searched.
- **The notice appeared twice** — `gapStatement()` appends `removalNote()` itself, and the caller then
  added `disclosure` (the same note) on top. Reached only when every sentence is removed *and*
  `refused` is false — which is what happens when the model writes "could not find", a refusal marker
  that sets `sawRefusal`. Confirmed with a stack trace: two `removalNote` calls inside one
  `verifyAnswer`.

Neither was introduced by the chat gate. Both were latent in the shared verifier and could only surface
once a surface with non-repository evidence began verifying.

### The bridge — go and look, don't relax the gate

```
search returns ONE result whose evidence lacks the query terms
  → read the message in full        (absence from a SNIPPET is not absence from a message)
  → still absent? list + open the attachments through the canonical file pipeline
  → stop the moment the term is actually in front of us
  → only then may the answer say where it was found — about a FILE that was read
```

Narrow on purpose: one result only, terms genuinely absent, at most three attachments. An ordinary
search whose terms are in the body costs nothing extra. When nothing readable holds the term, the turn
says the provider matched but the term was **not located**, and invents no evidence for it.

Two further false rejections had to go first, both the same root cause — a rule written when evidence
*was* a repository span:

- `mentions()` searched `item.text` alone, so a filename was invisible to **rule 1**, the first rule,
  which rejects as fabrication before the rule that would have found the term ever runs.
- A file's **stem and extension** name the same file, and verbs of evidential relation
  (*appears, contains, shows, found*) state where something is rather than assert anything checkable.

### Live, after the fix — 3/3

> The term "MIGRA_EMAIL_SENTINEL_0909" was found in the attachment "migrapilot_email_fixture.pdf"
> **rather than in the message body.**

Zero statements removed. No repository language. Telemetry per turn: `search → read_message →
attachment_list(2) → attachment_read(1)`. Streaming still buffered behind the gate (1 token frame).
Cross-principal isolation: 0 mailbox operations for the other principal. No internal evidence id in any
answer.

Gates: brain-service **3207/3207**, `tsc` clean.

---

## Lane 2026-09-10 — normal chat reaches the mailbox, and the live test earned its keep

`73e2ae5e` · `38b85f2c` · `19cbc440` · `5a3e8dfe` · `38bce47b`

**Status: READY FOR OWNER PRODUCT ACCEPTANCE.** Local only. Nothing is deployed.

Gates: brain-service **3198/3198**, shared-types **70/70**, consumer **1161/1161**, `tsc` clean in all three.

### The grounding gate — `2119c71f`, `7e60fd33`, `9fc42792`

`/api/ai/answer` and the autonomous loop have verified their claims for a long time. `/api/ai/chat`
never had; it predates the gate, and nothing noticed while it had no retrieved evidence of its own to
be wrong about. The moment a mailbox became reachable from normal chat, the surface people actually
type into was the one surface with no gate on it.

`capability evidence → TypedEvidenceLedger (+ repo chunks) → model → completed answer → the SHARED
verifier → emit`. Decided **once**, above both answer paths — streaming and buffered are separate code
here, so a check wired into one of them is a check with a documented bypass.

- **A gated turn buffers.** A token on screen cannot be un-said, so nothing is emitted until the answer
  is complete and checked, then exactly one frame. Live: **1** token frame gated, **406** ungated. The
  client is told `stage: verifying` in between.
- **Repo-only chat is untouched.** It has never verified; switching that on in the same change would
  make any regression unattributable.
- **Fails closed.** A verifier exception returns a refusal, never the raw model text.
- **What you see is what is stored.** Those diverging is how an unverified claim becomes next turn's
  context.
- **No second verifier.** `aiRoutes` may not import `claimVerifier` at all, and a test asserts it.
- **Internal evidence ids never reach a user** — both the ids a run issued and the id *shape*, because
  the leak to guard against is a model inventing `[email_7]`. Stripped, never translated: translating a
  label would *manufacture* a citation to evidence that was never involved.

### Three more defects the real mailbox found

1. **A true description was deleted.** "…sent by X, and the subject line is Y" failed the every-term
   rule because `email`, `sent`, `subject` and `line` are not *inside* the message. A repository claim
   quotes identifiers that really are in the code; a message claim mostly *describes* a message. That
   vocabulary is now part of what a non-repo source can be quoted on — per kind, and it costs no
   discrimination, because the **value** still has to match.
2. **An exact answer carried a false caveat.** Answering from the *complete* spreadsheet, the reply said
   "based on message previews" — the attachment *listing* is deliberately incomplete evidence and was
   still in the ledger. Every figure was right and the disclosure told the reader to discount them.
   Partiality now follows the evidence ids that actually sourced surviving claims. *A false caveat is a
   false statement, in the direction that looks careful.*
3. **"The spreadsheet" beside a PDF refused to choose.** Right for `Q3-budget.xlsx` beside
   `Q3-budget-final.xlsx`; wrong here — it was declining to use a fact the provider had already
   reported. A named file type is matched against the file's *own* declared type. Two files of the same
   named type still ask.

### The full chain, live through normal chat

| Ask | What ran | Result |
| --- | --- | --- |
| "search my email for the test file" | `stage=search` | grounded answer, partiality disclosed |
| "who sent that email, and what is its subject line?" | `stage=read_message` | *"sent by migrateck@gmail.com, and the subject line is «test file»"* |
| "what values does the spreadsheet attached to that email contain?" | `attachment_list` (2) → `attachment_read` (1) | **48273.55 / 7319.42 / 91504.08** — the fixture's exact values |
| another principal says "that email" | — | no content, and **zero** mailbox operations of their own |


### What a person can now do

Type into normal chat — no email route, no tool call — and get an answer from their own mailbox:

| Turn | What happened | Proof |
| --- | --- | --- |
| "search my email for the test file" | selected `migra.email`, searched the **real** Gmail mailbox, answered from what came back | `email.operation stage=search count=1` |
| "who sent that email, and what is its subject line?" | **re-read** through the capability under the current identity | `stage=read_message` |
| a *different principal* says "that email" in the same conversation | resolved nothing, got no content, and triggered **no mailbox search of their own** | exactly **one** mailbox operation for the whole exchange |
| "where is the rate limiter in this repo?" | repository planning kept, mailbox untouched | no `email.operation` |

That third row is the one worth reading twice: a failed cross-scope reference does **not** become an
implicit authorization to search the asker's mailbox instead.

### Four defects only the real mailbox could show

Every one of them passed the entire suite first, because a fake provider matches whatever the fake
decides to match.

1. **The whole prompt was the query.** Real Gmail: `"test file"` → 1 result; *"search my inbox for the
   message about the test file"* → **0**. A provider ANDs its terms. The search succeeds, the count is
   zero, and "nothing was found" is indistinguishable from an empty mailbox.
2. **A bare "it" was a backward reference**, so *"…and tell me who sent it"* refused to search and asked
   the user to clarify what "it" meant. The pronoun points where the rest of the sentence points.
3. **A comma hid a reference.** Matching required a space, `?` or `.` after the phrase, so *"who sent
   that email, and what is its subject line?"* fell through to a search — and **still answered
   correctly, from the previous turn's summary.** That is exactly the failure re-reading exists to
   prevent: disconnect the mailbox in between and the same sentence appears, out of remembered prose,
   with nothing checking whether the user may still see it.
4. **The model wrote an internal id to the user** — "I've retrieved the message from `[email_1]`…".
   This route has no verifier downstream to rewrite citations out of prose.

Plus one silent state: a user whose mailbox is **not connected** received no context at all, so the
model answered a mailbox question from its own knowledge. It is told now, in the engine's own words,
never naming a provider — and only when the caller is identified, because an unidentified request must
not learn whether a mailbox exists.

### Architecture the slice forced

- **One workbook reader.** The consumer already owned a qualified `.xlsx` reader; a second one in the
  Brain would have been two opinions about what a sheet says. The *reader* is shared now
  (`@migrapilot/shared-types/workbook`); the two *renderings* are not — the classifier tidies numbers
  for arithmetic, evidence copies them literally, because `1.10` tidied to `1.1` is a value the
  grounding gate can no longer find.
- **`.xlsx` had been promised and never implemented.** The file policy has classified it "accepted and
  analysed" since the three-state model landed, and `STRUCTURED_ONLY_EXTENSIONS` had **no consumer
  anywhere in the service**. A spreadsheet passed every gate, arrived as bytes, and stopped.
- **The verifier was generic over two kinds, not over kinds.** `groundInOther` built the email haystack
  itself from `subject`/`from`/`sentAt`, so a third kind was ungroundable by construction. Adapters now
  supply their own searchable surface; the *standard* stays shared.
- **Citations were per paragraph.** One `path:line` anywhere in a block made every non-repo claim in it
  unsupported. Now per sentence — and the full suite is unchanged, which is the evidence that
  repository verdicts are intact.
- **The `.gitignore` allowlist does not reach subdirectories.** `packages/shared-types/src/workbook/*`
  was written, built and green while being uncommittable.

### Known limits — read before promising anything

- **A search returns previews**, so a turn answering straight from search results has most descriptive
  prose removed as unsupported — truthful, but thin. Reading the single result when a search returns
  exactly one message would fix it, and is a **product decision**, not done.
- Conversation evidence is **in-memory**: a restart forgets what "that email" pointed at and the next
  turn asks. Fails safe.
- The query builder is a heuristic. One leftover word of phrasing costs every result.
- The local 8B model occasionally refuses to relay mail content (1 in 5 identical requests).
- A `conversationId` not shaped `conv_[a-z0-9]{6,}` makes the memory store mint a new conversation per
  turn, so nothing carries forward. Pre-existing memory behaviour.

Disconnect-between-turns was **not** re-tested live — it would need the owner's consent revoked and
re-granted. It is covered by the earlier live qualification plus unit tests against the real registry
and readiness path.

---

## Lane 2026-09-09 — summary as orchestration; the second router deleted

`0de85e61`. Every Migra Email surface is now either product-reachable or gone.

### routeEmail: deleted, not parked

It turned a sentence into a tool call with no identity. The agent loop already reaches `migra.email`
through the same authenticated capability executor the HTTP route uses, so keeping it would have
meant **two routing authorities**.

It was checked for a legitimate candidate-generation caller first: every export of `emailRouting.ts`
*and* `plan.ts` had **zero consumers**, and `planTurn` — the orchestration classifier that genuinely
exists and is called — has no email awareness and no hint-consuming surface. A pure classifier with
no caller is still dead architecture, and dormant architecture gets wired back up by someone who does
not know why it was parked. Both files and their 39 tests are gone. If an email hint is wanted for
Automatic later it belongs **inside `planTurn`** — a second classifier beside the real one is the
same shape of problem as a second router.

### `migra.email { op: summarize }`

    principal → connection → canonical provider read → evidence → completeness → prose → provenance

The provider is never told a summary is happening. The summariser is handed **finished text and
nothing to fetch with** — no provider, no connection, no credential, no principal.

| Invariant | How it holds |
|---|---|
| 1. no cross-principal evidence | the fixture transport answers per bearer token, so a wrong-connection summary carries visibly wrong subjects |
| 2. partial evidence → partial summary | the disclosure is **attached**, whatever the model wrote |
| 3. failure ≠ confident summary | provider failure, empty mailbox and generator failure all return **before any prose exists**; the generator is asserted never to have run |
| 4. claims trace to evidence | sources are canonical evidence ids + provider message ids; a thread summary carries only its own thread |
| 5. one implementation | `executeEmailSummarize` has exactly one call site, asserted by counting |
| 6. no identity → fail closed | refused, generator never runs |
| 7. no planner bypass | asserted by **absence** of the deleted files |

Mutations caught: trusting the model's prose instead of attaching the disclosure; summarising an
empty mailbox; building the scope with owner in place of workspace.

**Not implemented, deliberately:** per-sentence claim attribution. Grounding is enforced at the
**source** level. The repo claim verifier was not reused — it is built on paths, line spans and repo
terms, and applying those heuristics to email prose would be wrong.

### 🚨 My own test was vacuous first

`if (!r.ok && 'failure' in r) assert(...)` **skips silently** when the outcome shape differs. Removing
the empty-mailbox guard turned the result into a refusal, and the test passed anyway. Caught by
mutation, not by review. Every conditional shape check now asserts the shape unconditionally before
reading into it.

### Build gotcha

Deleting a source file leaves its **compiled output** in `dist/`. `tsc -b` does not remove orphans, so
the suite kept running `emailRouting.test.js` against code that no longer existed, and the gate failed
on a test for a deleted module.

Gate: brain **3032/3032** (3058 − 39 deleted + 13 new), consumer **1173/1173**.

### Next
Live qualification only, and it is blocked on the mailbox: seed it and reconnect. Nothing is accepted
or deployed; production remains `chat-platform-rc-0908`, schema 26.

---

## Lane 2026-09-09 (final) — one policy, one identity, attachments reachable

Three commits, each its own evidence boundary: `e78a9bea` transport, `fde2defa` file policy,
`5931048f` identity + attachments.

### One policy implementation, two callers

The attachment rules lived only in the consumer. Gmail attachments needed the same decisions, and
restating them in the Brain would have produced a second source of truth **across two processes** —
whose drift shape is an attachment accepted by email and refused by upload, or worse the reverse.
That file already carried the scars of the same failure in one process: the picker once offered 48
extensions while storage accepted 27.

They moved to `@migrapilot/shared-types/file-policy`. The consumer's `capability.ts` re-exports and
defines nothing. **Enforcement resolves per caller** — `saveFile` calls `resolveFilePolicy` with the
authenticated principal instead of a set captured at import time, and the Brain's ingestion calls the
identical function. The principal is *required* even though no rule varies by workspace today, stated
plainly in the type rather than implied.

### The autonomous loop learns who it is acting as

`agentRuntime` carried no identity, so every connected-account capability was denied inside it —
and nothing looked broken, because a denial is what a correct system does when it cannot tell who is
asking.

`ExecutionIdentity` is derived once at the authenticated boundary and frozen onto the run:
`principalId` and `workspaceId`, nothing else. No account id, no token, no provider state, no
readiness snapshot — each of those would let a run keep reading a mailbox that was disconnected while
it ran.

**Readiness stopped being an executor input.** It was resolved by the HTTP route and simply not
resolved by the agent loop: two callers, two behaviours, one silently wrong. It is now derived inside
`executeToolCore` from the principal, through one resolver both share.

> 🚨 **Half of that wire was also missing.** `registerToolExecutionRoutes` returned
> `{ registry, approvals, audit }` **without** the resolver — and those deps are exactly what the
> agent service is handed. Threading identity alone would have left the loop resolving nothing, with
> the denial still looking like a correct refusal.

### Attachments are product-reachable

`migra.email` gained `listAttachments` and `fetchAttachment`. The caller names **two ids** — no
filename, no MIME type, no size, no policy. Evidence is derived from a message the caller's own
connection just returned, so a prompt cannot decide what a downloaded file claims to be, and
provenance records what arrived rather than what was claimed.

### The four regressions, each mutation-tested

| # | Property | Mutation that breaks it |
|---|---|---|
| 1 | one runtime, two principals, interleaved — no bleed | runtime caches the last principal |
| 2 | A's turn cannot execute Email with B's connection | same |
| 3 | no principal → denied at the gate, never a global lookup | fallback to a default principal |
| 4 | a policy change moves upload *and* Gmail ingestion | Brain grows its own policy |

Gate: brain **3058/3058**, consumer **1173/1173**, 0 fail, 0 skipped.

### Still not reachable

`routeEmail` and the whole of `emailSummary` still have **zero callers**. The autonomous loop can now
reach `migra.email` through the model's own tool selection, so the deterministic planner may be
redundant — that is an open decision, not an oversight.

### Next
Seed the QA mailbox and reconnect. The disconnect qualification ran on the freshly reconnected grant
and revoked it again — `pg_stat_user_tables` on `mail_connection` reads `inserts=1, updates=2,
deletes=1`, which is exactly the reconnect, the forced expiry plus refresh, and the disconnect.
Seeding never landed: `users.getProfile` still reports `messagesTotal=2`.

---

## Lane 2026-09-09 (latest) — Migra Email: qualified as far as it is wired

**Passed against the real QA mailbox**, through the full per-principal path:

- **search / readMessage / readThread** — real content, correct addresses and dates
- **Token refresh under a real expiry** — `expires_at` forced into the past; the read succeeded
  transparently, `last_refresh_at` went null→set, expiry moved into the future, and the sealed token
  **changed** (`c1a197…`→`cc9971…`). Still sealed, no plaintext.
- **Cross-principal isolation** — a different owner, and the same owner in a different workspace, are
  both denied. A foreign principal holding the **real provider message id** is still denied.
- **Disconnect scoping** — a foreign principal naming the **real `provider_account_id`** gets 404 and
  the row is untouched.
- **Disconnect** — row gone, **revoked at Google**, status flips to `not_connected`, and an immediate
  read fails even with a known real message id. Nothing was memoised.
- **Telemetry** — zero addresses, subjects, bodies, `ya29.`/`1//` or `Bearer` in any log, while real
  mail was being read.

### 🚨 Three read-slice surfaces have no caller anywhere

Grepping for callers across `apps/*/src` finds **none** for:

| Surface | Reachable from |
|---|---|
| `routeEmail` (intent routing) | nothing |
| `emailSummary` (grounded summarisation) | nothing |
| `executeEmailListAttachments` / `executeEmailFetchAttachment` / `bridgeDownloadedAttachment` | nothing |

`migra.email`'s schema admits only `op: search \| readMessage \| readThread` — there is no attachment
op to call. So **attachment retrieval, canonical file ingestion, grounded summarisation and live
intent routing cannot be qualified through the product at all.** This is the same defect class as the
missing Gmail transport: built, mutation-tested, declared complete, reachable by nothing.

Two of the three are **not** simple oversights:

- The attachment bridge takes its `AttachmentPolicy` **by injection on purpose** — allowed types and
  size limits belong to the consumer's file pipeline, and the bridge's own header says restating them
  in the Brain would create a second source of truth that drifts. Exposing a `fetchAttachment` op
  means deciding how the consumer's policy reaches the Brain. That is a design decision inside the
  slice, not a qualification step, so it was not made unilaterally.
- Live intent routing runs in the model turn, and **`agentRuntime` still carries no principal** — the
  gap that must close through the governed identity boundary, not by bolting account state onto the
  agent.

### 🚨 The QA mailbox was never seeded

Gmail's own `users.getProfile` reports **`messagesTotal=2`** — the two Google onboarding messages,
zero attachments. `messages.list` with `q=''`, `q='in:anywhere'` (which covers Spam and Trash) and
`q='has:attachment in:anywhere'` returned **2, 2 and 0** ids, `resultSizeEstimate` **2, 2 and 0**.

Listed ids equalled returned messages, so the adapter's 404-skip was **not** hiding them. Nothing was
delivered to that address. The sentinel and exact-XLSX assertions could not be run.

### Next
Bonex: seed the mailbox **and** reconnect (disconnect revoked the grant, so consent will be shown
again — that was the test). Then the wiring decision for attachments/summarisation/routing. Production
untouched: `chat-platform-rc-0908`, schema 26; migrations 27/28 still unapplied there.

---

## Lane 2026-09-09 (later) — Migra Email: a real mailbox, actually read

**MigraPilot read a real Gmail inbox.** Search, full-message read and thread read all executed
against the QA account through the whole per-principal path — capability gate, sealed tokens,
refresh, scope check, provider construction, telemetry.

Gate: brain **3050/3050**, 0 fail, 0 skipped (+25 Gmail transport tests, 3 mutations caught).

### 🚨 The read slice was never connected to Gmail

With a real consented connection, sealed tokens in Postgres, and readiness reporting
`available: true`, **every search returned `not_configured`.**

`GmailProvider` had **zero HTTP**. Every operation returned `unconfigured()` unconditionally —
ignoring even a valid access token that was sitting right there in its own config. The parsing was
complete and tested; nothing ever called it.

**3016 tests passed over that**, because every layer above the adapter was tested against *fake*
providers. A fake proves the shape of a contract. It cannot prove anyone implemented it.

The note two sections down already said "the Gmail adapter has no HTTP seam". The slice was called
complete anyway. Recording a gap is not the same as counting it.

> **Lesson, standing:** a slice is complete when the *outermost real dependency* has been exercised,
> not when every layer above it passes against a double. Fakes verify contracts; only the real
> boundary verifies the product.

### What the transport now decides

A status code is not a failure kind, and the layers above act on which one it is:

| Gmail says | We say | Because |
|---|---|---|
| 401 | `authorization_expired` | the token was minted moments earlier — this is the **grant** failing |
| 403 `insufficientPermissions` | `insufficient_scope` | consent fixes it |
| 403 anything else (rate limits) | `provider_unavailable` | "reconnect" would send a throttled user to grant **wider** access and overwrite a working grant |
| 404 | `not_found` | |
| 429, every 5xx, unrecognised 4xx | `provider_unavailable` | inferring expiry from an unfamiliar status throws away a working connection during someone else's outage |
| no answer | `provider_timeout` | on **our** ceiling; the transport has none |
| 200 that will not parse | `provider_unavailable` | **not** an empty mailbox |

Also held: search uses `format=metadata`, so no result can claim a complete body (proven live —
search `bodyComplete: false`, read `true` with a 4548-char body); a message that 404s mid-search is
skipped, but one we *failed to read* fails the whole search rather than silently shrinking an inbox;
`search({threadId})` routes to the thread, because Gmail's query grammar has no thread operator and
dropping it would search everything and call it that conversation; an attachment's filename and type
come from the **message**, never the caller. `createDraft`/`send` stay unimplemented on purpose —
the refusal is the absence of code, and no mutating verb or path appears in the file.

### Still unqualified

The QA mailbox holds only Google's own two onboarding messages and **no attachments**, so attachment
retrieval, the canonical file pipeline, grounded summarisation over real evidence, token refresh
under a real expiry, and disconnect/reconnect are all still unproven.

### Operational loss

The Brain qualification Postgres was **removed mid-session** — no container, no volume — and the
sealed connection went with it. Replaced by a named, non-ephemeral container `migrapilot-brainqual`
(recorded in `/tmp/qual-brain-container.txt`); schema 28 reapplied.

### Next
Bonex: press **Connect email** once more, and seed the QA mailbox (including at least one
attachment). Then attachments, summarisation and live routing. Production untouched:
`chat-platform-rc-0908`, schema 26; migrations 27/28 still unapplied there.

---

## Lane 2026-09-09 — Migra Email: the read slice, complete in code

All six ordered items built, mutation-tested and committed, in the sequence Bonex set:
**disconnect → read/thread → attachment → summarization → intent routing → observability.**

Gate: brain **3016/3016**, consumer **1171/1171**, 0 fail, 0 skipped; consumer build exit 0.

**Two defects of a single class, found before any real credential existed:**

1. **Per-user readiness lived in a process-wide singleton.** It would have reported one user's
   mailbox state to everyone, one wiring mistake from executing against their inbox.
2. **`migra.email` could never have executed.** The availability gate ran with no caller context,
   so a capability whose readiness depends on the caller was denied for *everyone* — which reads
   as "not available", never as a bug. Found only by executing through the real executor.

These produced the standing invariant: *a capability may be globally registered, but any readiness
or execution decision depending on user-owned state must be evaluated per request from the
authenticated principal.*

**Decisions worth keeping:**

- A **remedy is a token**, not prose to be parsed. `/connect/i` over the reason text passed the
  entire test file until two cases were written to separate them.
- The **partiality disclosure is attached, not requested**. Asking a model to disclose fails
  silently on the answer nobody reads.
- **Nothing is memoised** between calls. Caching a resolved provider broke nine tests, including
  the post-disconnect guarantee — the shape of the failure it models.
- Attachments are judged by **the bytes that arrived**, not the listing's claims.

**Open, recorded, not attempted:** `agentRuntime` carries no principal, so email cannot run inside
the model's autonomous tool loop (fail-closed); the Gmail adapter has no HTTP seam, so the live
provider path is unproven until real qualification.

### Next
Bonex presses Create, sets four env vars, names a test account. Then real Gmail qualification, then
the read-only RC freeze. Production untouched: `chat-platform-rc-0908`, schema 26.

---

## Lane 2026-09-08 — Migra Email: the OAuth path, steps 1–7

Built in the order Bonex set, and stopped exactly where a human has to act. **No Google Cloud
resource exists**; no credential has been created, read back or stored.

Gate: brain **2938/2938**, consumer **1124/1124**, 0 fail, 0 skipped — including 12 tests against a
real PostgreSQL, which is what proves migrations 27 and 28 apply rather than merely compile.

**What each step decided, in one line:**

| Step | The decision that mattered |
|---|---|
| 1. Config | The console is configured from the code, not the code from the console. `googleConsoleSetup()` generates the two exact values. |
| 2. Callback | The principal check runs **before** the exchange, so a forged callback costs nothing; three forged refusals share one sentence, because distinguishing them is a probing oracle. |
| 3. Token storage | Sealed under a key held **outside** the database. The AAD binds each ciphertext to its row — encryption stops a database *reader* and does nothing about a *writer*. |
| 4. Refresh | Only an explicit `invalid_grant` marks a grant revoked. A 500, a timeout and an unrecognised 400 are unavailability. |
| 5. Provider | The factory takes **no access token** — the absence of the parameter is the guarantee. |
| 6. Redirect URI | `https://chat.migrateck.com/api/account/mail/callback`, generated and asserted exactly on both sides. |
| 7. Routes | Scope always from request identity. Single-use state is `DELETE … RETURNING` in one statement, proven by racing ten concurrent takes. |

**Why a refresh token is sealed when conversations are not.** It is a credential to a system that is
not ours: it opens the user's actual mailbox from anywhere, survives a Migra password change, and
does not expire on its own. A database dump must not be a permanent key to every connected mailbox.

**The distinction that is easiest to get backwards.** An unreadable seal is *not*
`authorization_expired`. That state's remedy is "reconnect" — and reconnecting would overwrite a good
row to work around a misconfigured key, destroying the evidence. It surfaces as unavailability, and
the operator gets the real fact.

**Six test defects that mutation testing caught** — each one a test that passed against a
deliberately broken implementation. The two worth repeating: the AAD collision fixture varied two
fields that are *not adjacent* in the serialisation, so raw concatenation still produced different
bytes; and every consumer "signed-out" test had no principal at all, so it exercised the wrong guard
and never reached the one under test. Allowing anonymous mailbox connections broke nothing until a
test configured the signing secret that makes an anonymous principal exist.

**Measured, not assumed:** Fastify hands a GET handler no body at all, so one assertion there is
carried by the framework rather than by route code. The test says so.

### What is left, and who does it

- **Bonex:** `docs/migrapilot/email-google-cloud-setup.md` — consent screen, Gmail API, web OAuth
  client, the exact redirect URI, four environment variables, and a sealing key generated with
  `openssl rand -base64 32` (never pasted into chat, a commit or a screenshot).
- **Approval needed:** migrations 27 and 28 have **not** been applied to production. Production is
  still schema 26 on `chat-platform-rc-0908`. Nothing is staged or deployed.
- **Not built:** no UI control calls these routes yet; send orchestration is still unwired; only
  `gmail.readonly` is requested, deliberately.

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

### It then failed acceptance a SECOND time — read this before touching the indicator

The first fix moved the sentence to a status row and **left the wordless case exactly as it was**:
avatar, rounded bordered card, dots inside. So a cold start still showed MigraPilot's mark beside a
message-shaped container, and Bonex rejected it on the screenshot.

Both fixes were argued the same way — *"this is not a Message"* — and both times the screen said
otherwise.

> **Acceptance is about what the user perceives, not about component ownership.** A reader does not
> know which component rendered a thing. They know that an avatar next to a bordered card means
> MigraPilot spoke.

There is now **one** surface with no branch: an inline status line, dots always, the observed detail
when there is one. No avatar, no bubble or card, no border/radius/shadow on the container, no
timestamp, no Listen/copy/feedback. Two branches is how one of them got left behind, so a test pins
that the container does not change shape with its content.

`showsTurnProgress` retires the indicator once the answer starts arriving — `pending` alone had kept
it mounted underneath the streaming bubble for the rest of the turn.

Both guards assert **visual structure**, not just where the text lives: the suite names the chrome it
refuses (border, shadow, card radius, raised surface, avatar, controls, timestamp), and the live
harness reads **computed style** in the browser so it fails on chrome however the classes are spelled.

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

And one hop further out, added 2026-09-07 during the cold-start acceptance:

> **Build identity on the server is not evidence that the browser is executing that build.**

`/api/version` reported the fixed build and the served chunk contained the fixed markup — both true —
while an open tab still ran the pre-fix client and produced a screenshot of the old defect. A human
test starts with a **hard reload**; an automated browser harness must assert the **client** build
before collecting evidence and fail closed on a mismatch. A fresh Playwright profile sidesteps this by
accident, which is exactly why the harness did not catch it — that accident is not a guard.

**2. Durable idempotency — the gate before every meaningful mutating tool.** A platform primitive, one
authority, no per-tool copies, keyed on canonical normalized operation identity:

    idempotencyKey + toolId + actor + scope + normalizedInputHash
      → pending | committed | failed_before_dispatch | outcome_unknown
      → durable result / reconciliation record

Until it exists: no Gmail send, no create operations, no deploy, no destructive file actions, no charges.

**3. Spreadsheet quantitative reasoning — the one PARTIAL inside Priority A.**
🚨 Do not stack more XLSX-specific patches. Finish the **shared quantitative substrate** so CSV, TSV
and XLSX all consume the same reasoning/aggregation contract.

---

## Project access is a platform capability, not a VS Code feature

**Bonex, 2026-09-07, from real Pilot Web behaviour. Priority A finding — RECORDED, NOT STARTED.**
The queued acceptance → harness → idempotency → spreadsheets work finishes first. This does not block
the current slice.

A design/build request in Pilot Web **refused truthfully** because the conversation had no connected
project — and then exposed the internal capability id `workspace.inspect` and told the user to move to
VS Code.

> **The refusal is correct and must survive any fix.** There was no connected project; inventing one
> or answering anyway is the failure this codebase refuses everywhere else. What is wrong is the
> wording, and the architecture the wording reveals.

### Two defects in one sentence

**An internal identifier on a screen.** The copy interpolates the plan step id directly:

- [outcomeDispatcher.ts:115](apps/brain-service/src/engine/orchestration/outcomeDispatcher.ts#L115)
- [decide.ts:95](apps/brain-service/src/engine/orchestration/decide.ts#L95)

both build `` `${step.step} needs a project it can use, but …` ``. `workspace.inspect` is a capability
identifier from [outcomePlan.ts](packages/shared-types/src/outcomePlan.ts) — the same class of leak
already closed on the model picker.

**Remediation that assumes one client.**
[inspectRoutes.ts:74](apps/brain-service/src/engine/workspace/inspectRoutes.ts#L74) hardcodes
*"Open a folder in VS Code (File → Open Folder), then retry."*, and
[projectAuthority.ts:59](packages/shared-types/src/projectAuthority.ts#L59) labels the authority
*"the workspace open in VS Code"*. A **platform** capability is telling a web user to install a
different product.

### Required architecture

- no internal capability identifiers in user copy
- project/workspace access is a shared Brain/platform capability, **not** VS Code-specific logic
- Web must eventually connect/select an **authorized** project and invoke the same
  inspect → propose → diff → write pipeline
- with no project connected, offer a canonical **Connect project** action rather than redirecting to
  another client
- VS Code may supply richer local filesystem context — a **client context advantage**, not ownership
  of the capability
- every write still passes shared authorization, preflight, consent, provenance and idempotency

The write half depends on **durable idempotency** (schedule item 2), already the gate in front of every
non-idempotent tool. Connect-project and read-only inspect from Web do not.

🚨 **Do not fix the wording alone.** A remediation string that stops naming VS Code while the
capability is still owned by one client hides the architecture defect instead of closing it — the leak
is only the symptom that made it visible.
