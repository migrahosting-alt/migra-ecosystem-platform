# Production-parity canary (VM111)

Exists so failure modes can be exercised for real **without damaging the live service**.
Built 2026-08-22. Same release artifacts as production, its own everything else.

## Topology

| | production | canary |
|---|---|---|
| consumer | `10.10.0.13:3000` (LAN — the public proxy forwards here) | `100.95.14.29:3100` (**tailnet only**) |
| Brain | `127.0.0.1:3988` | `127.0.0.1:3989` |
| Brain env | `/etc/migrapilot/brain.env` | `/etc/migrapilot/brain-canary.env` |
| consumer env | `/etc/migrapilot/consumer.env` | `/etc/migrapilot/consumer-canary.env` |
| state DB | `/var/lib/migrapilot/brain-state.db` | `/var/lib/migrapilot-canary/brain-state.db` |
| uploads | production `UPLOAD_ROOT` | `/var/lib/migrapilot-canary/uploads` |
| units | `migrapilot-{brain,consumer}.service` | `migrapilot-{brain,consumer}-canary.service` |

**No public route.** `curl http://10.10.0.13:3100/` is refused — the canary consumer binds the
tailnet address only, so nothing the edge proxy forwards can reach it.

Env files are seeded with `cp` from production and then **appended** with overrides. systemd
applies the last assignment for a key, so the overrides win and no production secret is ever
read to build them. Keep a baseline before injecting a fault:

```bash
sudo cp /etc/migrapilot/brain-canary.env /etc/migrapilot/brain-canary.env.bak   # restore with the reverse
```

Isolation is verified, not assumed: a conversation created on the canary Brain returns **404 on
the production Brain**.

## How faults are induced

**No test switches.** Every fault below is a real environmental failure applied to the canary's
own isolated resources — a stopped unit, an unreachable dependency, an unreadable file. Nothing
in the shipped code was modified to make a failure reachable, which is the whole point: the code
under test is byte-identical to production.

## Fault matrix — run 2026-08-22, Brain `64490c3b`

| case | how induced | result |
|---|---|---|
| Brain outage | `systemctl stop` the canary Brain | ✅ real refusal; production Brain and consumer unaffected |
| Recovery from outage | restart | ✅ back to 200; durable state intact |
| Capability unavailable | speech runtime pointed at a dead port | ✅ **honest** — `state: unavailable`, `model: null`, `supportedLanguages: []`, reason `"The speech runtime could not be reached: fetch failed"`. No fabricated readiness. |
| Storage read failure | `chmod 000` the state DB | ⚠️ see the finding below |
| Recovery from storage failure | restore mode + restart | ✅ `persistence: ready`, `schemaVersion: 8`, `migrationState: current`; pre-failure durable data intact |
| Durability semantics | `memoryMode` session vs durable across restart | ✅ `session` does not survive and **says so** (`durable: false`); `durable` survives |

### 🚨 FINDING: a durable write is acknowledged as stored while persistence is down

With the state DB unreadable, the Brain answered a `memoryMode: durable` write with:

```json
{"ok":true,"stored":true,"message":{"...":"...","durable":true}}
```

After permissions were restored and the service restarted, **that conversation was gone**
(`UNKNOWN_CONVERSATION`), while a durable conversation written before the failure survived
intact. So the acknowledgement was false: the caller was told the data was stored and durable,
and it never was.

The Brain **knew**. Throughout the failure `/health` reported, accurately and with the real
cause:

```json
"status": "degraded",
"readiness": { "persistence": "unavailable", "memory": "unavailable", "rag": "unavailable",
               "schemaVersion": 0, "migrationState": "failed",
               "detail": "unable to open database file" }
```

The health surface is exemplary. The **write path simply does not consult it** — it reports on
the in-memory store's success and calls that `stored: true`. This is the standing rule
*memory must not outrun durable persistence*, failing in production code rather than in a test.

Nothing here is silent-by-design: `/health` is the correct signal and it works. The defect is
that a write is acknowledged as durable on the strength of a memory write alone.

Secondary: `/api/ai/engineer/stores/health` reported `healthy` throughout, because it describes
the in-memory proposal/approval stores. True in isolation, misleading during a persistence
outage — two health surfaces disagreeing is an operational hazard on its own.

## Post-fix rerun — Brain `fea97a1`, 2026-08-22

The finding is closed. The same sequence, replayed against a real database on the canary:

| step | result |
|---|---|
| durable write while healthy | `stored: true`, `durable: true`, really on disk |
| `chmod 000` the state DB, restart | `/health` → `degraded`, `persistence: unavailable`, `"unable to open database file"` |
| durable conversation during the outage | **HTTP 503** `PERSISTENCE_UNAVAILABLE` — *"Durable storage is unavailable, so this was not saved. Nothing was stored."* |
| **session** write during the outage | ✅ still created, `mode: session` — it never promised disk |
| restore + restart | `status: ok`, `persistence: ready`, schema 8 |
| pre-failure durable data | ✅ intact (`survivor GREEN LANTERN 404`) |
| the refused writes | ✅ **absent** — neither the durable nor the session conversation written during the failure came back |
| new durable write after recovery | ✅ `stored: true`, `durable: true`, and survives a further restart |

Where it previously answered `{ok:true, stored:true, durable:true}` and lost the data, it now
refuses and says nothing was stored. Covered by `test/durableWriteTruthfulness.test.ts`, which
encodes this exact sequence.

Production was promoted to the same artifact after the canary proved it, and smoke-tested:
durable write `stored/durable: true`, session mode intact, a real chat turn answered normally.

## Authenticated canary — LIVE, 2026-08-22

The consumer half is now reachable. `migrapilot_canary` exists as a **separate** OAuth client
against the real production issuer (`https://auth.migrateck.com`), and the canary consumer is
bound to **loopback only**, reached through an operator SSH tunnel.

```
ssh -L 3100:127.0.0.1:3100 migrapilot-app-core     # then browse http://localhost:3100
```

Why loopback rather than the tailnet: the session cookie is `httpOnly`, `secure` and host-only,
and none of those may be relaxed for testing. Browsers treat `http://localhost` as a **secure
context**, so a `Secure` cookie is sent over the tunnel with no TLS, no certificate and no DNS —
and the canary ends up *less* reachable than a tailnet binding, not more.

### Verification run at creation

| check | result |
|---|---|
| `migrapilot_web` unchanged | ✅ field-by-field before/after diff, `UNCHANGED: true` |
| canary login targets only the canary callback | ✅ `client_id=migrapilot_canary`, `redirect_uri=http://localhost:3100/api/auth/callback`, scopes identical to production, PKCE S256 |
| session cookie still `httpOnly` | ✅ absent from `document.cookie` |
| canary conversation uses canary Brain/state only | ✅ canary lists **1** conversation; production lists **95** |
| that conversation absent from production | ✅ not listed, and a direct fetch 404s |
| canary session secret | ✅ its own `MIGRAPILOT_CANARY_APP_SESSION_SECRET`, generated on the host and never printed |

The client was created by a **targeted upsert of one row**. The general seed was never run —
its `update` block rewrites `redirectUris` wholesale for every client it names.

### 🚨 FINDING (fixed): a storage outage blamed "the assistant service"

With the canary Brain's database read-only, the Brain answered a precise
`503 PERSISTENCE_UNAVAILABLE` — and the consumer flattened it to `502 brain_error`, showing:

> The assistant service could not complete this request.

A model-fault reading of a storage fault, with an identical retry as the only apparent action.
The code was in the Brain's response body the whole time; the generic mapping never read it.

Fixed in `e7a2951` and re-verified live through the UI:

> **503 persistence_unavailable** — "Your message could not be saved, so it was not answered.
> Storage is unavailable right now — nothing was lost, because nothing was stored."

### What the run established about reachability

**The assistant-side "produced but not saved" case is NOT reachable by breaking storage before a
turn.** The prompt is persisted before the model runs, so the user append fails first and fails
closed — correctly, since answering a turn whose prompt was never stored leaves a conversation
that cannot be reconstructed. Reaching the assistant-side case needs storage to fail *between*
the user append and the assistant append. Recorded as reachable-only-in-a-narrow-window rather
than assumed working; it remains covered by unit tests at the route and client layers.

### Two smaller findings

- **`/health` reports `persistence: ready` against a READ-ONLY database.** It checks that the
  store opens, reads and reports a current schema — not that it accepts writes. Honest for what
  it measures, optimistic as a write-readiness signal.
- **Restoring a SQLite database's mode is not enough.** SQLite created `brain-state.db-shm` with
  the read-only mode it inherited, so writes stayed blocked after the `.db` was restored. The
  `-shm` and `-wal` sidecars must be restored too, or recovery silently does not happen.

### Recovery confirmed

Storage restored → Brain restarted → the turn answered `144`, four messages persisted, and the
pre-outage marker (`CANARY ISOLATION MARKER 5150`) intact.

## Authenticated destructive matrix — run 2026-08-22

All four cases driven through the authenticated canary UI/API, with **real infrastructure
faults only** — a read-only SQLite store, an unreadable upload root. No test switches.

### 1. Index-promotion failure ✅

Baseline: `alpha-canary.txt` indexed, `state: approved`, answering with a citation. Store made
read-only, then a new document uploaded and indexed.

| assertion | result |
|---|---|
| candidate does not become approved/searchable | ✅ `searchable: false`, `state: degraded`, chunk counts show **only alpha** |
| nothing claims success | ✅ HTTP 502, `sync_failed` |
| no fabrication of the un-indexed content | ✅ the `betaCode` question failed closed, 503 |
| existing approved index intact | ✅ chunk counts preserved through the fault |
| recovery promotes cleanly | ✅ both files indexed, both answer, `state: approved` |

The fault landed at **sync**, not at promotion — both write to the same store, so file
permissions cannot isolate the promotion step. Recorded as what actually happened rather than
claimed as an isolated promotion failure. The invariant under test holds either way.

⚠️ **Finding, not yet fixed:** the message is `"Your files could not be read. Nothing was
indexed."` The files were perfectly readable; the STORE could not be written. Same misdirection
class as the chat-path defect fixed in `e7a2951`, and it points the user at their documents
instead of at the outage.

### 2. `UPLOAD_ROOT` read failure — 🚨 found a real defect, now fixed

With the upload root unreadable for a **single turn**:

| assertion | before fix | after fix |
|---|---|---|
| no fabrication | ✅ | ✅ |
| no leak of document contents | ✅ | ✅ |
| durable grounding retained | ❌ **erased to `[]`** | ✅ preserved |
| usable again after recovery, no re-attach | ❌ **never came back** | ✅ answers again |

`reconcileGrounding` reported every name as `missing` when the library could not be read, and
the caller correctly treats `missing` as "deleted, drop it permanently". One storage hiccup
therefore destroyed the user's own choice, permanently — the exact outcome the function's doc
comment forbids. Fixed in `25bf79f`; an unreadable library now reports `libraryUnreadable` with
an empty missing list, and no set derived from it is ever persisted.

### 3. Partial-delete cleanup ✅

Store made read-only, then `beta-canary.txt` deleted **through the real Files UI**.

- route returned **`DELETE /api/files?name=beta-canary.txt → 207 Multi-Status`**
- the deployed warning appeared verbatim: *"The file was deleted, but your search index could
  not be updated, so its contents may still appear in answers until indexing runs again."*
- it did **not** masquerade as a clean delete
- after recovery and re-index, the deleted content is unreachable — `IRON HERON 902` is gone

Limitation: the stale-content window itself could not be observed, because the same outage that
fails the purge also fails chat turns closed. The 207 and the warning are proven; "content
briefly retrievable after a failed purge" is not.

### 4. Non-searchable / recovery transition ✅ (with a recorded limit)

Retained conversation state never made unavailable content retrievable: during the outage the
durable set stayed `["alpha-canary.txt"]`, the turn failed closed at 503, and nothing was
fabricated. After recovery the conversation answered **without re-attachment**.

An honest distinction worth keeping: with only the store read-only, the index correctly reports
`searchable: true` — it genuinely *is* readable and approved, and the block is on the
conversation write path. The `degraded`/`searchable: false` state was reached in case 1, where a
failed index write left it there. **A pure "index unsearchable while everything else works"
fault still has no natural inducer**, and manufacturing one would need the test switch this
programme forbids. Unchanged from the earlier finding.

## Still open

- **Health needs a writable dimension.** `persistence: ready` means "opens, reads, migrations
  current" — a READ-ONLY database reports ready. Too broad a name for what the write path now
  guarantees; read readiness and write readiness should be separate.
- **The assistant-output-not-saved window stays explicitly unverified.** It needs storage to
  fail between the user commit and the assistant commit. Not to be manufactured by distorting
  the architecture.
- **`sync_failed` blames the user's files for a store outage** (case 1).

## Superseded limitation — the consumer half

Still untested through the authenticated product: index-promotion failure, storage-read failure
through `UPLOAD_ROOT`, partial-delete cleanup failure and the real 207 UI, and non-searchable
transitions as the *user* meets them. The auth blocker below is now CLOSED — these are simply
the next cases to run.

The reason is not a gap in the canary. The session cookie is `httpOnly`, `secure`, and
**host-only** (`packages/auth-client/src/session.ts` sets no `domain`), so it cannot be replayed
to another host — correctly. And `resolveAuthPort` offers exactly two ports: real MigraAuth or
fail-closed. There is deliberately no stub, and building one would be exactly the fake test
switch this programme forbids.

Closing it requires a decision, because it changes production auth configuration:

1. **Register a separate `migrapilot_canary` OAuth client** with its own redirect URI, plus a
   tailnet hostname and TLS for the canary. Isolated; cannot affect the production client.
2. Add a redirect URI to the existing `migrapilot_web` client. Smaller, but the seed path is an
   upsert that rewrites **all** redirect URIs, so it can clobber production sign-in.

Recommended: **(1)**. Until then the canary covers the Brain, storage and capability layers, and
the consumer layer is recorded as untested rather than assumed working.
