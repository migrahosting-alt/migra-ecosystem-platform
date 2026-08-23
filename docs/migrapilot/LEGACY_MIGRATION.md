# Legacy import — the utility, and what it found

The legacy SQLite state is a **migration source artifact**, not a supported
persistence backend. PostgreSQL is the only target architecture.

```
legacy Brain state
      ↓  read-only extraction        legacySource.ts
canonical normalized records         records.ts
      ↓  per-scope import            importer.ts   (every write declares its scope)
PostgreSQL
      ↓  exact reconciliation        reconcile.ts
      +  historical integrity audit  chunkAudit.ts
```

Run it with `dist/src/engine/persistence/migration/runMigration.js`:

```bash
node runMigration.js \
  --source /path/to/A-COPY-of-brain-state.db \
  --database-url postgres://...        # or MIGRAPILOT_BRAIN_DATABASE_URL
  --run-id 2026-08-23-rehearsal \
  [--audit-only] [--verify-only] [--json report.json]
```

`--audit-only` needs no target at all: the integrity audit compares the legacy
state against the source files on disk, so it can run before any database exists.

## Take a COPY. Never point it at the live file

The live database is served by a running Brain in WAL mode, and reading it
mid-write imports a torn state. A consistent snapshot, taken from a **read-only**
connection:

```bash
node --input-type=module -e "
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('/var/lib/migrapilot/brain-state.db', { readOnly: true });
db.exec(\"VACUUM INTO '/home/bonex/legacy-copy.db'\");
db.close();"
```

Verified not to modify the source: `sha256 e6cdfd30…` before and after.

## Design decisions, and why

**Every write goes through `PostgresDurableStore`.** The same adapter production
uses. Bulk SQL would bypass the scope declaration, the row-count invariant and
the composite foreign keys — the three things that make the target trustworthy —
and drift from the schema the moment either side changed.

**The import is driven per (owner, workspace).** There is no global bulk
transaction, because under `FORCE ROW LEVEL SECURITY` a statement with no
declared scope matches zero rows and reports success. A "fast bulk copy" would
finish instantly and import nothing.

**Resume is pinned to a sha256 of the whole source file.** Row counts or an mtime
would let a changed source pass as "the same migration" and interleave two
datasets into one target. A changed fingerprint is refused; a legitimately new
source needs a new run id.

**Checkpoints are written after each stage commits, never before.** A checkpoint
written first claims work a crash then prevented, and the resume skips it
forever.

**The legacy chunk row id is deliberately NOT compared.** Migration 11 changed
persistence identity on purpose. SQLite keyed chunks by
`${indexId}:v${version}:${path}#${line}`; PostgreSQL keys them by
(owner, workspace, index, version, logical key), where the logical key is the
engine's own `${path}#${line}`. Requiring the old string to survive would be
requiring the defect to survive. Logical identity and content are compared
instead — what retrieval actually depends on.

## What the utility found before it ever touched production

### 1. Chunk identity omitted the index version — would have destroyed history

Migration 11 keyed chunks by (owner, workspace, index, chunk_key). That cannot
hold the same logical chunk at two index versions: committing v29 takes the v28
row as its `ON CONFLICT` target and **rewrites** it.

Production holds exactly that shape — `idx_7g3a9o5brg` has chunks at v28 **and**
v29, `idx_t7247x7cs4` at v2 **and** v3. An import under the old key would have
collapsed them at the moment of migration. SQLite never had the problem; its row
key carried the version.

Migration 13 widens the tuple to include `index_version`.

### 2. An empty grounding set was stored as NULL

"I detached every file" and "I never attached one" are different facts, and the
first was being written as the second. Only `undefined` becomes NULL now.

### 3. `saveConversation` always wrote `deleted_at` as NULL

Importing a soft-deleted conversation would have resurrected it in front of the
user who deleted it — worse than losing one. The insert now carries the
timestamp; the conflict path uses `COALESCE(existing, incoming)` so a re-save
still can never un-delete.

## Historical chunk-integrity audit — real production data, 2026-08-23

Source: `legacy-copy.db`, a `VACUUM INTO` snapshot of the live state.

Inventory: 115 conversations · 270 messages · 0 summaries · 0 workspaces ·
4 indexes · 34 index versions · 10 127 chunks · 8 976 cached embeddings ·
838 audit events · 2 usage records. 0 deleted conversations.

| index | scope | source | verdict |
|---|---|---|---|
| `idx_31twfee4sn` | local / default | present, **via a moving symlink** | `verified_against_source` |
| `idx_3r8gt43uq4` | user:74e5… / personal | **gone** | `historical_integrity_unverified` |
| `idx_7g3a9o5brg` | user:74e5… / personal:74e5… | **gone** | `historical_integrity_unverified` |
| `idx_t7247x7cs4` | user:8c32… / personal:8c32… | **gone** | `historical_integrity_unverified` |

**Did the legacy key already destroy information? No — and the reason matters.**

The legacy row key was `${indexId}:v${version}:${path}#${line}` — already index-
and version-qualified — so two indexes over the same root could not overwrite
each other. The cross-tenant collision that migration 11 fixed existed **in the
first PostgreSQL port, not in the legacy SQLite state.**

That is not a theoretical distinction. Three indexes hold logical keys that
another index also holds — 5, 6 and 1 of them respectively. Under the
pre-migration-11 PostgreSQL key those 12 chunks would have collided on import.
Under the legacy key they coexisted, and they coexist in the target now.

**`verified_against_source` is weaker than it sounds for `idx_31twfee4sn`.** Its
root is `/opt/migrapilot/brain-service/current/dist`, and `current` is the
release symlink — it currently resolves to release `fea97a1`, not the tree that
produced the index. Every persisted file still exists there (0 missing from
source), but the comparison is against the source **as it is now**. The report
prints this caveat rather than letting a deploy-shaped coincidence read as proof.

The 630 files "in source but not indexed" are 300 `.d.ts`, 300 `.map`, 29 `.js`
and 1 `.tsbuildinfo` — declaration and sourcemap files the indexer skips, in a
tree that has been redeployed many times since the index was built.

**Three of four indexes cannot be source-verified at all.** Their upload
directories were deleted. What exists is migrated as-is and recorded as
`historical_integrity_unverified`. That is the honest state, not a pass, and it
is what the report says.

## Limits of this audit, stated plainly

- It compares the **latest** chunk version per index. Cross-index overlaps at
  older versions are not counted.
- For a source that still exists, it compares against the source **now**.
- It cannot reconstruct what an index held at the time it was built.
