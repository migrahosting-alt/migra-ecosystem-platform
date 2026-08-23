# PostgreSQL cutover — acceptance matrix

**Frozen 2026-08-22, before `migrapilot_brain` exists.** Written now so the criteria cannot be
relaxed to fit a run. Every case names the exact thing it proves; a case that cannot be executed
is recorded as unexecuted rather than assumed.

Adapter code is complete at `d18db48` (`PostgresDurableStore`, 1584/1584 tests). Nothing below
has been run — there is no database yet.

## Gate 0 — provisioning (owner-level, blocked)

| # | check | passes when |
|---|---|---|
| 0.1 | `migrapilot_brain` role exists | `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION` |
| 0.2 | `migrapilot_brain` database exists, owned by that role | `\l` shows the owner |
| 0.3 | `PUBLIC` revoked on database and schema | a second role cannot connect |
| 0.4 | Console's `migrapilot` database untouched | its table list is byte-identical before/after |
| 0.5 | `pg_hba.conf` permits only VM111 | `10.10.0.13/32` and `100.95.14.29/32`, `scram-sha-256` |
| 0.6 | DSN installed on VM111, never displayed | `MIGRAPILOT_BRAIN_DATABASE_URL` present; value never printed |
| 0.7 | connectivity from VM111 | `current_database=migrapilot_brain`, `current_user=migrapilot_brain` |

## Gate 1 — RLS enforcement, against the real database

**This is the gate that matters.** Everything else assumes the database enforces tenancy; these
cases prove it. A mocked equivalent would assert our own assumption rather than PostgreSQL's
behaviour, so none of these may be simulated.

| # | case | passes when |
|---|---|---|
| 1.1 | correct scope succeeds | conversation under `owner:A/ws:X`, `saveMessage(m, {A,X})` commits and reads back |
| 1.2 | **cross-owner write rejected** | conversation under `A/X`, `saveMessage(m, {B,X})` → PostgreSQL error; **no row under A, none under B** |
| 1.3 | **cross-workspace write rejected** | conversation under `A/X`, `saveMessage(m, {A,Y})` → rejected; no row anywhere |
| 1.4 | undeclared scope sees nothing | a query with no `withScope` returns zero rows — not an error, zero rows |
| 1.5 | scope does not leak across pooled connections | after a scoped transaction, the next borrower of that client sees nothing until it declares its own |
| 1.6 | `saveSummary` obeys the same three | 1.1–1.3 repeated for summaries |
| 1.7 | `commitSync` scope enforcement | chunks commit under the right scope; a mismatched scope is rejected |
| 1.8 | 🚨 **`saveIndex` workspace mapping** | see below — this is an open question, not a formality |

### 1.8 in full — the `workspaceId` / `workspaceScope` question

`PersistedIndexRecord` carries `ownerScope` and `workspaceId`. The aggregate currently maps
`workspace: rec.workspaceId`, because there is no `workspaceScope` field on that record.

Those are **different kinds of identifier**. A workspace *id* is not self-evidently the workspace
*scope* string RLS compares against. If they diverge, `WITH CHECK` rejects every index write.

- **Pass:** `saveIndex` commits, and the row's `workspace_scope` equals what a conversation in the
  same workspace carries.
- **Fail:** rejection, or a row whose scope does not match the conversation's.
- **On failure: fix the data contract** — add a real `workspaceScope` to `PersistedIndexRecord` and
  thread it from the caller. **Do not** coerce the id into the scope, and do not relax the policy.
  The mapping being wrong is a modelling defect, not an RLS inconvenience.

## Gate 2 — adapter behaviour

| # | case | passes when |
|---|---|---|
| 2.1 | commit failure rejects | a failing write throws; the caller is never told it was stored |
| 2.2 | rollback on throw | a mid-transaction failure leaves no partial row |
| 2.3 | no client leak | pool size is unchanged after N successes and N failures |
| 2.4 | one transaction per method | two ordinary calls are two transactions; a crash between them leaves the first committed |
| 2.5 | `createConversationWithFirstMessage` is atomic | a failure on the message leaves **no** conversation |
| 2.6 | `loadDurable()` throws | it does not return `[]` — empty data and unavailable authorization stay distinguishable |
| 2.7 | `loadDurableForScope` returns only that scope | another scope's conversations are absent |
| 2.8 | **readable-but-not-writable reports degraded** | revoke write, then `health()` → `memoryStore: 'degraded'`, never `ready`. This is the canary finding, re-proved on the real engine |
| 2.9 | migrations idempotent | `initialize()` twice leaves the schema at one version, no duplicate objects |

## Gate 3 — no fallback

| # | case | passes when |
|---|---|---|
| 3.1 | Postgres unreachable → refuse | the Brain does **not** start on SQLite; it fails with a precise message |
| 3.2 | no SQLite file touched | with Postgres configured, `brain-state.db` mtime is unchanged after a full run |
| 3.3 | wrong credentials → refuse | no silent degrade to an empty store |

## Gate 2b — candidate boot/restart durability — **PASSED 2026-08-22**

Release `fd8d50a` on `migrapilot-brain-postgres-candidate.service` (:3990),
`MIGRAPILOT_PERSISTENCE=postgres`, schema 11, `migrationState: current`.

Driven through the real HTTP API by `apps/brain-service/gates/`. Split across a
genuine `systemctl restart`, because that is the only thing that separates "the
database recorded it" from "the process remembers it".

| step | result |
|---|---|
| 1 · deploy the scoped-write fix | `fd8d50a` installed, content gate passed, boot-tested on :3999 |
| 2 · health precondition | `persistence: ready`, `migrationState: current`, schema 11, no detail — enforced by the harness, `exit 2` otherwise |
| 3 · pre-restart, `candidate-gate write` | **9/9** |
| 4 · pre-restart, `approved-index-gate phase1` | **13/13** |
| 5 · restart | new process, uptime reset |
| 6 · post-restart, `candidate-gate read` | **10/10** |
| 7 · post-restart, `approved-index-gate phase2` | **8/8** |
| 8 · SQLite untouched | `sha256 e6cdfd30…`, db mtime `16:14`, wal mtime `19:17` — both **before** the candidate first started at `23:57` |

The two assertions this gate existed to add, both with a control that must pass first:

- **approve index → restart → still approved** — `state=approved approvedVersion=1`
  after a cold process, and the first request after the restart retrieves and
  cites the approved content.
- **delete conversation → restart → still deleted** — gone from the list, `404`
  on direct fetch, messages did not come back; while the sibling conversation
  that was *not* deleted returned with its content intact.
- **delete workspace → restart → still deleted**, with the control in another
  scope — which also proves the delete did not reach across scopes.

### What it caught

| defect | how it presented |
|---|---|
| five writes crossed the persistence boundary with no scope | approve succeeded, restart said `experimental` / no approved version |
| `DELETE` with `content-type: application/json` and no body | `500 Internal server error` — Fastify rejected the empty body before the route ran |
| the deployment boot test | created a SQLite database in the staging tree and shipped it into two PostgreSQL releases |

Row-count invariant added at the same time: any scoped `UPDATE`/`DELETE` that
affects zero rows raises `ScopedMutationMissedError`. Delete semantics decided
explicitly — "already absent" is a **mismatch**, not idempotent success, because
under FORCE RLS "already gone" and "not yours" are the same observation.

## Gate 4 — migration parity

Counts alone are insufficient; sample real records.

```
source conversations        vs  target
source messages             vs  target
per-conversation message counts (every conversation, not a sample)
conversation ids missing in target        → must be empty
conversation ids extra in target          → must be empty
grounding sets           source vs target
ownership scopes         source vs target
memory modes             source vs target
```

**Expectation is exact, not approximate:** the ~96 live conversations survive with identical ids,
identical message counts, and identical grounding sets. "Roughly the same" is a failure.

Migration runs **per scope** under `withScope` — never by disabling RLS for a bulk import.
It must be idempotent: a second run duplicates nothing, keyed on the source's canonical ids.

### Gate 4 status — 2026-08-23

Utility built and proven against a real PostgreSQL and a real SQLite source:
`apps/brain-service/src/engine/persistence/migration/`, 17 integration cases,
full suite 1643/1643. Design and findings: `LEGACY_MIGRATION.md`.

| step | state |
|---|---|
| read-only extraction + consistent `VACUUM INTO` snapshot | **done** — source sha256 unchanged by the copy |
| historical chunk-integrity audit on REAL production data | **done** — see below |
| resumable/idempotent import with source-fingerprint pinning | **done**, covered by crash-and-resume and double-import cases |
| exact reconciliation, proven to fail on a tampered target | **done** |
| import rehearsal into an isolated target | **BLOCKED** — needs `migrapilot_brain_rehearsal` on db-core (`provision-rehearsal-postgres.sh`) |
| candidate Brain booted against the migrated database | pending the rehearsal |

**Two defects found before production was touched**, both in code already
deployed to the candidate:

1. Chunk identity omitted `index_version`, so committing a new version rewrote
   the previous version's chunk instead of adding one. Production holds exactly
   that shape (chunks at v28 **and** v29; v2 **and** v3), so an import under the
   old key would have destroyed version history at the moment of migration.
   Fixed by migration 13.
2. An empty grounding set was stored as NULL, and `saveConversation` always wrote
   `deleted_at` as NULL — so importing a soft-deleted conversation would have
   resurrected it in front of the user who deleted it.

**Historical collision question — answered.** The legacy row key was
`${indexId}:v${version}:${path}#${line}`, already index- and version-qualified,
so the legacy SQLite state lost nothing. The cross-tenant collision migration 11
fixed lived in the first PostgreSQL port. Not academic: three indexes hold
logical keys another index also holds (5, 6 and 1), so 12 chunks would have
collided on import under the pre-migration-11 key.

**Three of four indexes cannot be source-verified** — their upload directories
were deleted. Recorded as `historical_integrity_unverified`, migrated as-is, and
NOT reported as parity. The fourth is rooted at the release symlink, so its
verdict compares against today's tree rather than the one that was indexed; the
report prints that caveat rather than letting it read as proof.

## Gate 5 — canary before production

The canary moves to its own Postgres database first, then the destructive matrix re-runs against
it: Postgres unavailable, write denied, durable-write truthfulness, restart recovery, grounding
persistence, storage-failure reconciliation, partial-delete 207. A canary on a different
persistence engine than production proves nothing about production.

## Gate 6 — production cutover

1. stop the Brain cleanly
2. freeze a final SQLite backup (read-only, retained — **not** deleted at cutover)
3. final incremental migration
4. reconcile (Gate 4) — **stop here if anything differs**
5. switch env to Postgres
6. start, verify `/health`
7. existing conversation history present
8. real authenticated turn through `chat.migrateck.com`
9. reload — it persisted from Postgres
10. a grounded conversation still answers with citations

## Gate 7 — posture guard, last

Only once Postgres is serving production:

```
NODE_ENV=production + MIGRAPILOT_PERSISTENCE=postgres  → boots
MIGRAPILOT_PERSISTENCE=sqlite                          → refused at startup
```

Both directions proved, converting the existing policy comment into a runtime guarantee.

## Then, and only then — SQLite removal

`SqliteDurableStore`, its fixtures, schema and helpers come out. The one legitimate remaining
use is a **read-only migration/rollback artifact** for the retention window, and it is not a
persistence option.

⚠️ **Two things must happen before the delete, or it destroys value:**

1. The Postgres parity suites currently use `SqliteDurableStore` as their **correctness oracle**
   (`postgresRag.test.ts`, `postgresAgentRunConcurrency.test.ts` — *"measured against a real
   SqliteDurableStore"*). Deleting the oracle does not fail those tests; it silently stops them
   proving anything. They must first be rewritten against fixed expected values.
2. 16 of 124 Brain test files touch SQLite. Until disposable Postgres test databases exist, that
   removal leaves the Brain with **no runnable persistence tests at all** — worse coverage than
   the policy violation it fixes.
