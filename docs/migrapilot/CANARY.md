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

## Known limitation — the consumer half is not yet reachable

The canary consumer runs, serves, and is correctly isolated, but its **authenticated** routes
cannot be exercised yet, so these remain untested: index-promotion failure, storage-read failure
through `UPLOAD_ROOT`, partial-delete cleanup failure, and non-searchable transitions as the
*user* meets them.

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
