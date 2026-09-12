# MigraPilot AI Chat Assistant — overnight report, 2026-09-12

Scope: the chat assistant only. **No VS Code extension, VSIX, rc.1–rc.7, or parity work was
touched.** Production was not deployed to, and Google Cloud, the Gmail OAuth client and the
tailnet ACL were not modified.

Everything below was measured against **`3c204aa8` / `staging-3c204aa8`**, the release
staging is actually serving. Tonight's code changes are **committed, not deployed** — staging
still runs the pre-fix build, and the report says so wherever it matters.

---

## 1. Staging endurance — 79 / 80

Path: browser → tunnel `127.0.0.1:3200` → consumer `/api/chat/stream` → Brain `/api/ai/chat`
→ capability router → provider. Driven from the authenticated owner session (the cookie is
httpOnly, which is also the correct product path). Pacing 1.8–2.5 s.

| class | n | ok | first token p50 | p95 | total p50 | p95 |
| --- | --- | --- | --- | --- | --- | --- |
| ordinary | 30 | 30 | 655 ms | 1188 ms | 1818 ms | 2863 ms |
| reasoning | 15 | 15 | 612 ms | 1249 ms | 1839 ms | 3160 ms |
| coding | 15 | 15 | 700 ms | 1146 ms | 2860 ms | 3770 ms |
| multi-turn | 10 | 10 | 640 ms | 1037 ms | 898 ms | 1444 ms |
| capability | 10 | **9** | 654 ms | 6853 ms | 1353 ms | 8006 ms |
| **all** | **80** | **79** | **655 ms** | **1249 ms** | **1823 ms** | **3770 ms** |

**Score: 98.75 %.** Full evidence in
[`evidence/staging-endurance-2026-09-12/`](./evidence/staging-endurance-2026-09-12/).

The one failure is preserved and not retried: *"Can you make me a picture of a blue circle?"*
→ HTTP 200 carrying `error: brain_error`, *"Image generation is not configured on this
server."* The **message** is right; the **code** is not — the Brain answered correctly and
promptly, so `brain_error` tells a client the wrong thing about who failed.

---

## 2. Model routing — how MigraPilot actually chooses

Asked the Brain directly, because `/api/ai/chat` is the **only** place `tier` and
`routing.reason` are reported at all.

| intent | model chosen | tier | why |
| --- | --- | --- | --- |
| greeting | `llama3.1:8b` | balanced | tier match |
| general knowledge | `llama3.1:8b` | balanced | tier match |
| deeper reasoning (no hint) | `llama3.1:8b` | balanced | tier match |
| summarization | `llama3.1:8b` | balanced | tier match |
| structured data | `llama3.1:8b` | balanced | tier match |
| tools required | `llama3.1:8b` | balanced | tier match + tools required |
| coding — *undetected* | `llama3.1:8b` | balanced | tier match |
| coding — detected | `qwen2.5-coder:14b` | balanced | local-first coding path |
| `needsReasoning: true` | `qwen3:8b` | balanced | reasoning-capable |
| `tier: deep` | 🚨 `gpt-oss:120b-cloud` | deep | reasoning-capable |
| `tier: fast` | `qwen2.5-coder:1.5b` | fast | tier match |

### Why `llama3.1:8b` despite `qwen2.5-coder:14b` being the profile default

**They are two different routing systems, and the env profiles do not drive chat.**
`/api/ai/chat` uses `ModelRegistry` + `capabilityRouter`, which selects from the live Ollama
catalog by capability — explicitly "not by static env vars". `MIGRAPILOT_*_MODEL` feeds the
older per-profile `providers/providerRegistry`, which chat does not consult.

Within the router, at `balanced` with no hints, the score is:

```
tier proximity   0        (both are 8–20B → balanced)
tools bonus     +1        (both tool-capable)
size tie-break  -0.02 × params
                 llama3.1:8b       0.84
                 qwen2.5-coder:14b 0.72
```

So the **size tie-break decides it** — at fast/balanced the router prefers the *smaller*
model. That is a deliberate, documented rule, and it is defensible. The consequences are not:

### Routing findings

1. 🚨 **`tier: deep` routes off-device.** `gpt-oss:120b-cloud` is **384 bytes on disk**
   advertising 116.8 B parameters — an Ollama Cloud manifest. A deep turn on staging sent
   **335 input tokens** to it and the engine reported `provider: local`, under a provider
   declared `dataLocality: 'on-device'` at `cost: 0`. It wins the deep tier outright because
   that tier scores `+0.05 × params`. Contradicts three standing rules at once: zero paid
   inference, "no recurring paid dependency enters quietly", and the on-device claim.
   **Fixed in `58e14894`** — labelled and excluded unless `MIGRAPILOT_ALLOW_REMOTE_MODELS=1`.
   Deep tier keeps `deepseek-r1:32b`, on the machine.
2. **Reasoning models are unreachable from the product.** `needsReasoning` picks `qwen3:8b`,
   and `deepseek-r1:*` is reachable only at `deep`. The consumer never sets `needsReasoning`
   and never requests `deep`, so *every* real user turn is `balanced` → `llama3.1:8b`.
   `migra-logic` exists as a family and cannot be reached.
3. **The coding heuristic is seven words.** `isCodingIntent` matches
   `code|function|bug|refactor|typescript|python|compile|stack trace`. It misses
   *javascript, sql, git, postgres, CORS, index, join* — so "What is the difference between
   SQL INNER JOIN and LEFT JOIN?" gets the general model while "Write a TypeScript function…"
   gets the coder. Measured both ways above.
4. **`tier: fast` picks the smallest thing, not the best small thing.** "Say hello" routed to
   `qwen2.5-coder:1.5b`, a *coder* model, with `qwen2.5-coder:1.5b-base` — a **base, not
   instruction-tuned** model — ranked second. A base model should never be chat-eligible.
5. `needsVision` / `needsEmbedding` in the request body are **ignored by design** — vision is
   decided by actual attachments, not a client claim. Correct; my first matrix row for vision
   was therefore not a defect.

---

## 3. Provider health truthfulness — **fixed**

The defect, exactly: a Brain with **no inference at all** reported

```
status: "ok"
providers: [ local:true, cheap:true, default:true, premium:true ]
```

`StubProvider.isAvailable()` returned `true` unconditionally, and the reachability probe
short-circuited stubs to `{ reachable: true, modelCount: 1 }` → `deriveHealth` → `healthy`.
`inferenceReady` is derived from those, and the service `status` from that. The only field
telling the truth was `gpuCapacity: unavailable`.

**Fixed in `58e14894`**, with the states the brief asked for kept separate:

| state | how it now reads |
| --- | --- |
| configured | the provider is declared at all |
| endpoint reachable | `reachable` — an endpoint answered a probe |
| authenticated | `unknown` + "credential absent" when the env var is missing |
| model available | `degraded` when reachable with zero models |
| **inference capable** | new `kind: 'live' \| 'stub'` on every health line, and a new `'stub'` status |
| capacity available | `gpuCapacity` / `gpuSignals` (already truthful — it was the one that was) |
| admitted / routable | admission gate + router, unchanged |

The stub still **works** — `complete()` and `stream()` are untouched, so offline development
and tests are unaffected. Only its *claim* changed. 8 regression tests; the neighbouring
suites stay green.

---

## 4. Conversation memory / history — solid

| check | result |
| --- | --- |
| multi-turn context (5 threads × 2) | **5/5** — name, city, number, dog, and a 3-item list all recalled |
| page refresh / reopen | history renders, 96 conversations |
| **consumer restart + Brain restart** | session survived, **96/96**, order and timestamps intact |
| CT101 container restart | both units and the database came back unattended |
| conversation list / titles / timestamps | present; titles derive from the first prompt |
| message order | user → assistant, with `createdAt` |

**Ownership isolation, measured on both dimensions** (controlled staging scopes only; no
fabricated production identity):

| as | result |
| --- | --- |
| owning owner + owning workspace | 200, conversation visible |
| **different owner**, same workspace | **404** |
| owning owner, **different workspace** | **404** |
| no scope headers, list | `{"conversations":[]}` |
| no scope headers, direct id | **404** |

And at the database layer, `FORCE ROW LEVEL SECURITY` is real: the application role sees
**0 of 96** conversations without the session scope variables set.

---

## 5. Authentication / session

| check | result |
| --- | --- |
| PKCE | `code_challenge_method=S256`, fresh challenge **and** state per login |
| state validation | forged `code`+`state` → 302 to `/?auth_error=exchange_failed`, **no cookie set** |
| callback validation | no params → 400; `error=access_denied` → handled 302 |
| session cookie | httpOnly — invisible to JS (only unrelated `pale_*` cookies are readable) |
| invalid / absent session | 401 `{"error":"unauthenticated"}`, no stack trace |
| redirect safety | `next=https://evil.example.com` and `next=//evil.example.com` both ignored; `redirect_uri` stays the registered one |
| **secrets in logs** | **none** — the only matches are variable *names* in "not set: MIGRAPILOT_GOOGLE_CLIENT_SECRET…", which is the documented safe behaviour |
| env file modes | all `600` |

MigraAuth was not weakened and the production OAuth client was not modified.

Minor: log files are `644`. They contain no secrets, so this is hygiene, not exposure.

---

## 6. Capability hub truth map

**The hub itself is truthful.** Every control states its real state with an actionable reason:

| control | state | what it says |
| --- | --- | --- |
| Files & documents | **LIVE** | "Attach a document, data file, or code for MigraPilot to read." |
| Your files | **LIVE** | reuse without re-uploading |
| Photos & images | **BLOCKED** | "Your image is saved. Reading images in a conversation is not enabled yet — no vision model has been approved for use." |
| Search the web | **NOT CONFIGURED** | "Web search is not set up yet." |
| Email | **NOT CONFIGURED** | "Email is not set up yet." |
| Dictate | **NOT CONFIGURED** | names the exact env var to set |
| Model selection | **LIVE** | "Automatic" + family picker |
| Projects / Assistants | **NOT CONFIGURED** | "…aren't available yet" |

### 🚨 P0 — the model contradicts the hub in prose

Ten "can you…?" questions. The model answered every one from its own priors; **nothing
consulted the capability registry the consumer already fetches to draw that very menu.**

| asked | answered | truth |
| --- | --- | --- |
| search the web? | "I can scour the web for news articles" | no provider exists |
| read an attached PDF? | "I do not have the ability to … read files" | **it can, and did** |
| look at an image? | "I'm a text-based AI…" | a governed vision route exists |
| check my email? | "you don't have an email set up yet" | invents a fact about the account |
| open a file from my computer? | "please provide me with the path" | it cannot read local paths |
| write and run code? | "Certainly!" | it does not run code |
| remember yesterday? | "I'm a stateless AI… each interaction starts from scratch" | **false — proven durable** |
| transcribe audio? | "I can process WAV or MP3 files" | no speech runtime |

This is the capability-owned-answer principle violated on a new surface — the registry knows
the exact answer, including each `unavailableReason`, and a model is being asked to
regenerate it from memory. The hub is already the proof that the facts are available.

Also: `terminal.exec` is `available: false` with **no `unavailableReason`** — the one disabled
capability that cannot explain itself.

---

## 7. Attachments — end to end

| type | upload | stored | indexed | **understood** |
| --- | --- | --- | --- | --- |
| `.txt` | ✅ | ✅ | ✅ | ✅ "MIGRA_ATTACH_SENTINEL_ALPHA … 8821", cited `note.txt:1-2` |
| `.csv` | ✅ | ✅ | ✅ | ✅ "**3310.25**" exact, cited `sales.csv:3` |
| `.json` | ✅ | ✅ | ✅ | ✅ exact key value |
| `.pdf` | ✅ | ✅ | ✅ | ✅ text recovered, `sourcePages: {report.pdf: "page 1"}` |
| `.png` | ✅ via `/api/images` | ✅ (id, mime, 1×1 dims) | — | ❌ no qualified vision model |
| `.doc` | ❌ refused | — | — | "MigraPilot cannot read this format yet — it would be stored without being understood." |
| `.wav` | ❌ refused | — | — | "MigraPilot cannot read .wav files." |

Refusals are truthful, specific and actionable. Deletion, ownership isolation and the
"Your files" reuse picker all work.

**The exact boundary**: uploaded → stored → indexed → understood is intact for text, CSV,
JSON and PDF. Images stop at **stored**. Audio stops at **refused**.

### Findings

1. 🚨 **P1 — "too large" was reported as "empty".** A 28.6 MB file of plain repeated ASCII
   uploaded fine (29,952,000 bytes stored) and then answered *"No readable content was found
   in huge.txt. Attach a file with text in it."* The user can open that file and read it, and
   the advice is to do what they already did. Cause: above the 25 MB extract ceiling it is
   never parsed, so the index holds the same zero chunks an empty file would.
   **Fixed in `50e2bcec`** — it now names the limit, with 5 regression tests.
2. **P1 — one unreproducible ungrounded denial.** In the first batch after the initial
   upload, all four attachment questions answered *"I don't see an attached file"* from the
   model, with **no error event**. It did **not** reproduce across 8 later attempts with
   byte-identical prompts and files. The refusal paths do work (`document_not_attached`,
   `insufficient_evidence` both fire correctly, including immediately after a fresh upload).
   Preserved as an unresolved intermittent — the dangerous shape is that the failure was an
   *ungrounded model denial* rather than a refusal.
3. **P2 — two different "accepted" lists.** `/api/files/capability.accepted` includes
   `png/jpg/gif/webp`, but `/api/files` refuses them (images belong to `/api/images`) and
   `limits.allowedExtensions` excludes them. The documents `<input type=file>` carries
   `accept=""`, so the OS picker does not filter and a user only learns after choosing.
4. **P2 — a 28.6 MB upload took 44 s with no progress indication.**
5. **P2 — every sub-KB file renders as "1 KB"** in the picker.

---

## 8. Vision readiness — the gap is **governance**, nothing else

Uploading a PNG returns **201** with a parsed image record and this:

```json
"vision": { "state": "no_qualified_model", "model": null, "installed": 4,
            "message": "Your image is saved. Reading images in a conversation is not
                        enabled yet — no vision model has been approved for use." }
```

So, precisely:

- ingestion ✅ (id, mime, dimensions, bytes)
- storage ✅
- multimodal routing ✅ (`needsVision` is derived from the attachment; the gate names the model)
- provider compatibility ✅ — **4 vision models are installed**
  (`qwen2.5vl:7b`, `llava`, `minicpm-v:8b`, `llama3.2-vision:11b`)
- client restriction ❌ not the cause — the control is disabled *because* of the state below
- **governed approval ❌ — this is the gap.**

And the reason staging cannot close it itself: **governance is `unsigned`** (no qualification
signing key), so no approval can even be recorded here. Production reports `migra-vision`
available and governed, so production holds a signed approval that staging does not.

**Exact requirement**: a qualification signing key on staging, then a signed approval for one
of the four installed vision models. No new model download required.

---

## 9. File / document readiness

The disabled document control seen earlier is **not present in `3c204aa8`** — "Files &
documents" is enabled and works end to end (§7). It was a stale deployment, not a capability,
registry, environment, storage or backend problem.

PDF: accepted, stored, text extracted, page-cited. The file record also carries
`processing: { state: "ocr_failed", failureReason: "the page renderer is not available on this
server" }` — the **OCR fallback** is unavailable on CT101, which did not matter here because
direct text extraction succeeded. A scanned/image-only PDF would fail on staging.

---

## 10. Web search readiness — NOT CONFIGURED, by design

`MigraSearch` holds `null` and reports itself not configured: *"Today there is no provider.
`migra-search-core` does not exist."* The boundary is Chat → Migra Search authority →
`SearchProvider` → SearXNG, and nothing above may learn the backend.

- provider configured: **no**
- advertised correctly: **yes** — visible, disabled, with a reason
- citation / grounding: not exercisable without a provider
- failure behaviour: "not configured" and "configured but down" are distinct states
- **exact dependency**: a `SearchProvider` implementation plus a self-hosted SearXNG
  (`migra-search-core`). **No paid service and no credential** — consistent with the cost rule.

---

## 11. Gmail staging preflight — one external step remains

Nothing in Google Cloud was touched and no mailbox was connected. The implementation is fully
present in `3c204aa8`: `search`, `readMessage`, `readThread`, `listAttachments`,
`readAttachment`, the capability-owned answer bridge, draft/send governance.

| item | value |
| --- | --- |
| callback path | `/api/account/mail/callback` — a **constant**, not configuration |
| redirect URI | `${MIGRAPILOT_PUBLIC_ORIGIN}/api/account/mail/callback` |
| scopes | `gmail.readonly` · `gmail.compose` · `gmail.send`, requested **separately per grant**; `openid`+`email` kept apart as identity |
| token storage | Postgres, `mail_connections` (migrations 27–28), on db-core |
| protection | AES-GCM **sealed**, key in `MIGRAPILOT_MAIL_TOKEN_KEY` held outside the database; GCM associated data binds each ciphertext to its scope, provider, provider account id and purpose |
| ownership binding | a sealed token moved to another row, another user, or the other token column **fails to open** — the graft attack is refused at the storage layer as well as at the callback |
| reconnect / revocation | `POST /api/ai/account/mail/begin`, `DELETE /api/ai/account/mail`; a persisted reference is a pointer, never a permission — every turn re-executes under the current identity |
| Brain state now | `EMAIL CONNECT DISABLED — not set: MIGRAPILOT_GOOGLE_CLIENT_ID, …_SECRET, …_PUBLIC_ORIGIN` |

### 🚨 The blocker is the origin, and it is not http

`oauthConfig` refuses a non-HTTPS public origin when `NODE_ENV=production` — and staging runs
`NODE_ENV=production` deliberately, for persistence parity. The http-on-localhost exception is
explicitly disabled in production. So `http://127.0.0.1:3200` **cannot** be the Gmail origin.

**What that means concretely:** staging needs a real HTTPS origin before Gmail can be wired.
`deploy-targets.sh` already names one — `DEPLOY_PUBLIC_HOST=staging-chat.migrateck.com`.

Owner decisions required, in order:

1. Stand up `staging-chat.migrateck.com` (DNS + TLS + a route to CT101:3000).
2. Set `MIGRAPILOT_PUBLIC_ORIGIN=https://staging-chat.migrateck.com` on staging.
3. In Google Cloud, add the redirect URI
   **`https://staging-chat.migrateck.com/api/account/mail/callback`** to the OAuth client.
4. Set `MIGRAPILOT_GOOGLE_CLIENT_ID` / `_SECRET` and `MIGRAPILOT_MAIL_TOKEN_KEY` on staging.

Step 3 is the only step outside our own infrastructure.

---

## 12. Capability-owned answer invariants

Existing coverage holds (10 tests, all green): an attachment name can never originate in model
text; attachment-list membership is deterministic across 20 runs; zero attachments is stated
as zero; a capability-owned answer makes **no** model generation call; provenance and
disclosure survive; streaming emits the **same payload character for character**; a hybrid
answer's exact file contents survive even when the commentary is refused.

Observed holding live tonight: CSV `3310.25` and the JSON key came back **exact**, with
citations, not paraphrased.

**Gaps found, against the classes you listed:**

| class | covered |
| --- | --- |
| email attachment lists | ✅ |
| file names | ✅ |
| spreadsheet values | ✅ |
| structured tool outputs | ✅ |
| **account metadata** | ❌ no coverage |
| **conversation metadata** | ❌ no coverage |
| **capability availability** | ❌ **and empirically violated** — see §6 |

§6 is the same principle on a new surface, and it is the largest single product-truth gap
found tonight.

---

## 13. Streaming quality

| check | result |
| --- | --- |
| first token promptly | p50 **655 ms** (p95 1249 ms) |
| progressive arrival | 19 token events spread 973 → 1230 ms |
| duplicated final message | **none** |
| partial corruption | none — output exact |
| cancel / abort | works; abort propagates and stops generation |
| **disconnect does not duplicate** | after aborting at 10 tokens, the conversation holds **only the user message** — no partial or duplicate assistant row |
| capability-owned answers stream unmutated | pinned by test ("same payload, character for character") |

First-token latency is measured separately from full-response latency throughout.

**Finding — no model attribution anywhere a user or auditor can see:**

- Brain returns `model`, `provider`, `tier`, `routing.reason`.
- Consumer `/api/chat` keeps `model` + `provider`, **drops** `tier` and `routing`.
- Consumer `/api/chat/stream` emits `meta`/`token`/`stage`/`done` — **no model at all**.
- `conversation_messages` has `model_id` and `provider_id`; the consumer's `appendMessage`
  operation does not carry them → **82 assistant rows, 0 with a model**.

The durable record of every staging answer cannot say what produced it. This is the same
class as the release-identity rule already in force.

---

## 14. Cold start / model loading

No loading state was ever emitted as assistant content. Loading appears as latency before the
first token, which is the correct place for it.

| | first token |
| --- | --- |
| very first turn (cold) | **5580 ms** |
| every turn after | ~650 ms |
| a *second* model being loaded mid-run | 6853 ms / 5879 ms |

An unavailable provider and an admission refusal both surface as structured errors, not prose.

---

## 15. Failure UX

| failure | what the user gets |
| --- | --- |
| capability unavailable (image gen) | "Image generation is not configured on this server." — truthful, **but coded `brain_error`** |
| web search / email / dictate | disabled controls naming the reason |
| unsupported file type | "MigraPilot cannot read .wav files. Attach a document, data file, or code file instead." |
| document not attached | "I do not have that document attached to this conversation… Attach the file here, or choose it from Files." |
| no readable content | truthful for genuinely empty files; **was wrong for oversized ones — fixed** |
| empty / malformed request | 400 `invalid_prompt` / `invalid_body`, one clear sentence |
| unknown route | 404 |
| auth expired / absent | 401 `{"error":"unauthenticated"}` |
| **stack traces or internals** | **none found in any response** |

**Not exercised: Brain unavailable, inference unavailable, DB unavailable.** Each requires
stopping a live staging service, which was declined by the safety guard. The mapping exists
in code and one instance was observed naturally (`503 brain_unavailable`, "MigraPilot could
not be reached right now") — but it is untested and should be marked as such.

Related: that same 503 is returned to an *unauthenticated* caller of `/api/capabilities` when
the real cause is `forbidden_for_principal`. The route collapses every non-ok gateway result
into "could not be reached". Pre-existing, identical on production.

---

## 16. Release / deployment

| check | result |
| --- | --- |
| staging commit | `3c204aa8`, both services, `stamped: true` |
| artifact identities | brain `sha256:99b11c3d…`, consumer `JrmsZXVpn6rLJ1n0F-beV` |
| systemd units | `migrapilot-staging-{brain,consumer}` active **and enabled** — proven by a container restart |
| release symlinks | per-app `current` → `releases/staging-3c204aa8` |
| rollback target | `chat-platform-rc-0908` present in both roots |
| production | `0f494d27`, untouched |

**Fixed — `deploy-consumer.sh` was the hole in `deploy-targets.sh`.** The production unit name
was hard-coded in the cutover restart **and in the rollback command the script prints**.
`--target staging` would have swapped the staging symlink then restarted a unit that only
exists on production; the printed rollback would have put the symlink back and restarted
nothing. `deploy-brain.sh` already resolved it from the target. (`50e2bcec`)

**Retention** (`scripts/release-retention.sh`, now `--base=`-aware, installed on CT101):
`--keep=1` caps staging at three — active, rollback target, one spare. Plan output keeps both
current releases and prunes nothing. It never selects the active release or the rollback
target, resolving both by pointer **and** by open file handle.

**The Tailscale SSH ACL is prepared and NOT applied** —
[`STAGING_SSH_ACL.md`](./STAGING_SSH_ACL.md). Verified still refused at the end of the run.
It deliberately avoids `autogroup:self`, which would have handed production SSH away in the
same stroke.

Remaining manual steps, and why each is still manual: the deploy scripts need SSH to the
target (ACL, above) and the `sudo` package on CT101. Everything else — build, stamp,
boot-test, identity check, symlink swap, restart, rollback — already exists in the scripts.
No second deployment framework was introduced.

---

## 17. Staging backup / recovery

**Already covered, and I found two things that would have bitten.**

A scheduled cluster-wide `pg_dumpall` runs on db-core daily at **02:30 UTC** as `postgres`,
gzipped, 7-day retention, root-only (`0700`/`0600`). Last run **succeeded today**, 265 MB,
6 generations present. It covers every database on the server, so it covers
`migrapilot_brain_stage`.

⚠️ **but** the staging database was created at ~06:30 UTC today — *after* today's run. The
first backup containing staging data will be tomorrow's.

Two real defects in the ad-hoc path:

1. **An application-role dump cannot work — and fails loudly, which is the good outcome.**
   `FORCE ROW LEVEL SECURITY` means `migrapilot_brain_stage_app` sees **0 of 96**
   conversations, and `SET row_security = off` (what `pg_dump` does) raises
   *"query would be affected by row-level security policy"*. So a backup taken as the app
   role stops rather than silently producing an empty file.
2. **CT101's client is PostgreSQL 15 against a 16.15 server**, so `pg_dump` refuses outright.
   `postgresql-client-16` is not in Debian 12 without the PGDG repo.

**Recovery must therefore run on db-core as `postgres`.** A restore rehearsal into a
throwaway database was **not** performed: creating one is permitted by the guard but
`DROP DATABASE` is deliberately not, and leaving an undeletable copy of conversation data on
the production database server is worse than not rehearsing. The exact commands are in the
status file for you to run and drop.

---

## 18. Security boundaries

| check | result |
| --- | --- |
| staging DB role → production DB | `has_database_privilege(...,'CONNECT')` = **false** |
| production DB ACL | `{migrapilot_brain=CTc/migrapilot_brain}` — PUBLIC has no CONNECT |
| production DB size | **200 MB, unchanged** |
| staging → production release trees | only ever **read** (two release dirs copied out); both symlinks and both units verified unchanged at the end |
| staging OAuth client | `migrapilot-consumer-staging_UXO9zoqUpD`, exactly one callback: `http://127.0.0.1:3200/api/auth/callback` |
| local-dev OAuth client | `migrapilot-consumer-local-develo_PFi1NHdpQe`, still only `http://127.0.0.1:3000/api/auth/callback` |
| production secrets copied | **none** — staging's DB credential was generated on CT101 and piped machine-to-machine; production's env files were never read (they are root-only, and reading them was not attempted) |
| env file modes | `600` |
| secrets in logs | none — variable **names** only |
| tenant isolation | enforced on owner **and** workspace, plus database-level RLS |

---

## 19. Consumer UX — P0 / P1 / P2

**P0**
1. **The assistant misdescribes its own capabilities in both directions** (§6). It offers web
   search and audio transcription it does not have, and denies file reading, image
   understanding and memory that it does. Fix: answer capability questions from the capability
   registry — the hub already proves the facts are available.

**P1**
2. **No model attribution anywhere** (§13) — not in the stream, not in `/api/chat`, not in the
   durable record.
3. **`brain_error` for "this feature is not configured"** (§1, §15) — a client cannot tell an
   outage from an unavailable feature.
4. **One unreproducible ungrounded attachment denial** (§7).
5. **`terminal.exec` is disabled with no reason** — the one control that cannot explain itself.

**P2**
6. Documents file input has `accept=""`; `/api/files/capability.accepted` over-advertises images (§7).
7. No progress indication on a 44 s upload.
8. Every sub-KB file shows as "1 KB".
9. `/history` renders **"No conversations yet."** in the pre-hydration frame while 96 exist;
   `/media` gets this right with "Loading your images".
10. Staging log files are `644`.

Implemented tonight, as narrow and clearly-wrong defects only: the oversized-file sentence,
provider health truthfulness, remote-model locality, and the deploy unit name. Nothing was
redesigned.

---

## 20. Lifecycle classification

`LOCAL IMPLEMENTATION → COMMITTED → READY FOR STAGING → DEPLOYED TO STAGING → OWNER VERIFIED
ON STAGING → READY FOR PRODUCTION → DEPLOYED TO PRODUCTION → OWNER VERIFIED ON PRODUCTION`

| capability | state |
| --- | --- |
| Chat (text, streaming, cancel) | **DEPLOYED TO STAGING** — awaiting owner verification |
| Conversation history / memory | **DEPLOYED TO STAGING** |
| Authentication / session | **DEPLOYED TO STAGING** |
| Attachments — txt/csv/json/pdf | **DEPLOYED TO STAGING** |
| Capability hub (the menu itself) | **DEPLOYED TO STAGING** |
| Model routing | **DEPLOYED TO STAGING** — with the findings in §2 |
| Files / Media / History pages | **DEPLOYED TO STAGING** |
| Provider-health truthfulness | **COMMITTED** (`58e14894`) — *not* on staging |
| Remote-model locality guard | **COMMITTED** (`58e14894`) — *not* on staging |
| Oversized-file refusal | **COMMITTED** (`50e2bcec`) — *not* on staging |
| `deploy-consumer.sh` target fix | **COMMITTED** (`50e2bcec`) |
| Vision / image understanding | **LOCAL IMPLEMENTATION** — blocked on a signed qualification |
| Gmail / Migra Email | **COMMITTED** — blocked on an HTTPS staging origin + one Google Cloud entry |
| Web search | **LOCAL IMPLEMENTATION** — authority exists, no provider |
| Speech / dictation | **NOT CONFIGURED** |
| Projects / Assistants | **NOT CONFIGURED** — honest empty states |
| Capability-owned capability answers | **NOT IMPLEMENTED** — the §6 gap |

**Nothing is OWNER VERIFIED. That is yours to declare, and this report does not do it for you.**

---

## 21. Off-machine source protection

The branch is **1173 commits ahead of `core/main` and exists on no remote** — the workstation
was the sole copy.

- `core` (`100.119.105.93`, self-hosted) is **unreachable** — that host is off.
- `origin` (GitHub, `Migrateck-Ecosystem`) **is** reachable, but pushing 1173 commits to a
  GitHub org repo is outward-facing and may trigger CI, so it was **not** done.

Instead: a complete bundle, verified and copied to a second machine.

```
file    migra-ecosystem-platform-50e2bcec-20260912T081603Z.bundle
bytes   67,265,173
sha256  8dcaf8bb9e213d51e1d4db04887f4295d46178e6f7902e55b2bddb61632b627e
verify  "The bundle records a complete history."
copy 1  /home/bonex/backups/migrapilot/   (workstation)
copy 2  CT101 /root/source-backups/       — hash re-computed there, MATCHES
```

**The exact push, for you to authorise:**

```sh
cd /home/bonex/workspace/active/MigraTeck-Ecosystem/dev
git push origin HEAD:refs/heads/backup/migrapilot-chat-2026-09-12
```

Non-destructive: it creates a new ref and touches no existing branch. Restore from the bundle
with `git clone <bundle> <dir>` or `git fetch <bundle> '*:*'`.

Leftover to clear when convenient: a 67 MB copy in the hypervisor's `/tmp` from the transfer
(the guard declined the cleanup command; it clears on reboot).

---

## 22. Password-reset email deliverability — **DEFERRED**

Explicitly not started. It is outside the chat assistant and the night's priority order ran
out before it. No mail or DNS configuration was touched.

---

## 23. Morning integrity check

| check | result |
| --- | --- |
| production still `0f494d27` | ✅ `chat-platform-rc-0908`, both symlinks, both units active |
| staging still `3c204aa8` | ✅ `staging-3c204aa8`, stamped |
| staging consumer healthy | ✅ |
| staging Brain healthy | ✅ `status: ok`, inference available, gpu ready |
| staging inference works | ✅ "MORNING CHECK OK" via `llama3.1:8b` |
| staging DB isolated | ✅ CONNECT to production = false |
| production DB untouched | ✅ 200 MB |
| no Google Cloud changes | ✅ email still `not set` |
| no Gmail connection changes | ✅ no mailbox connected |
| no Tailscale ACL changes | ✅ SSH still refused by policy |
| no production deployment | ✅ |
| no extension / VSIX work | ✅ no such path touched |
| no Copilot / Claude / Codex work | ✅ |
| no credentials in evidence | ✅ names only |

---

## Commits created tonight

| commit | what |
| --- | --- |
| `cda976eb` | staging exists and can be put back — runbook, status, rollback proven |
| `5b87e368` | staging parity — Tailscale, inference, db-core, `--base=` retention |
| `58e14894` | provider health truthfulness + remote-model locality guard (13 tests) |
| `50e2bcec` | oversized-file refusal (5 tests) + `deploy-consumer.sh` target fix |

Test state: Brain **3239/3241** — the two failures are an untracked-file check that clears on
commit, and the pre-existing `unifiedAgent` prompt test, untouched as instructed. Consumer
**1165/1166** — same untracked-file check. `tsc -b` clean.

---

## Unresolved owner decisions

1. **Tailscale SSH ACL** — [`STAGING_SSH_ACL.md`](./STAGING_SSH_ACL.md). Blocks the deploy tooling.
2. **`MIGRAPILOT_ALLOW_REMOTE_MODELS`** — deep tier is now on-device only. Say if you want the
   cloud model back.
3. **Model profile parity** — staging's `MIGRAPILOT_*_MODEL` values mirror the *local dev*
   Brain; production's env is root-only and was not read. They barely matter (the router
   overrides them) but they should be confirmed.
4. **Vision** — a qualification signing key on staging, then a signed approval for one of the
   four installed vision models.
5. **Gmail** — `staging-chat.migrateck.com` (DNS + TLS), then one redirect URI in Google Cloud.
6. **Off-machine push** — the command in §21.
7. **Backup rehearsal** — a restore into a throwaway database, and its `DROP`.

## Recommended next action

**Apply the Tailscale SSH ACL and install `sudo` on CT101, then deploy tonight's four commits
to staging with the real `deploy-brain.sh --target staging` / `deploy-consumer.sh --target
staging`.**

That single step converts staging from hand-built to pipeline-deployed, exercises the
boot-test and identity-check stages that have never run, proves the corrected rollback
command, and puts the provider-health and oversized-file fixes where you can verify them —
all before any of it is considered for production.
