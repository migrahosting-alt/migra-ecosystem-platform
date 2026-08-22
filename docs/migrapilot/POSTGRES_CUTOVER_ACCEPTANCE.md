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
