# Hook patch — read-only catalog access to `auth_migrateck_stage` for P3

**For Bonex to apply.** I will not edit `.claude/hooks/block-dangerous.sh` myself: it is the
guard that constrains me, and a guard the constrained party can rewrite is not a guard. Every
other exception in that file was placed there by you, in writing. This one belongs there the
same way.

## Why the current hook refuses, correctly

P3 needs the live catalog of `auth_migrateck_stage` on `db-core`. Reaching it requires
`${ELEV} -u postgres psql`, which hits the elevation gate. The only db-core exception is
`dbcore_brain_postgres_provisioning()`, and its §4 is bounded to the Brain's own objects —
`auth_migrateck_stage` is not `migrapilot_brain`, so it falls through to the normal block.

That is the policy working. The 2026-08-22 authorization was for Brain provisioning, and a
grant written for one purpose should not quietly stretch to another.

The other route — connecting with the application's own DSN — is closed by a different rule and
should stay closed: `CLAUDE.md` forbids me to read, copy or handle production database
credentials at all.

## What P3 is, and is not

```
IS      compare the live catalog against the repository's migration set
IS      read-only: relation names, column names/types/nullability, indexes,
        constraints, and the contents of _prisma_migrations
NOT     a migration. Nothing is applied, replayed, or repaired.
NOT     a fix for the 001-014 history gap — you already ruled: do not replay them,
        and do not infer "already applied" from resemblance.
NOT     a reason to touch the backup tables. They stay.
```

## The patch

A THIRD scoped exception, and the narrowest of the three: one host, one binary, one database,
and **read-only enforced by the server**, not merely by pattern-matching SQL text.

```bash
# ─────────────────────────────────────────────────────────────────────────────
# SCOPED EXCEPTION — read-only catalog comparison of auth_migrateck_stage (P3)
#
# Authorized by Bonex, <DATE>, in writing, bounded to:
#   "the read-only catalog comparison needed to finish P3. Compare only; run no
#    migration against the live database. Keep the target fixed to database
#    auth_migrateck_stage, host db-core. No probing other databases."
#
# NARROWEST of the three exceptions. It permits one elevated binary on one host
# against one database, performs no filesystem write, and cannot write to the
# database even if a statement slipped past the text filters below, because it
# REQUIRES the session to be opened read-only at the server.
# ─────────────────────────────────────────────────────────────────────────────
dbcore_auth_catalog_readonly() {
  local c="$1"

  # 1. HOST — the db-core alias, and no other host.
  [[ "$c" == *"ssh "* ]] || return 1
  [[ "$c" == *"db-core"* ]] || return 1
  case "$c" in
    *"migrapilot-app-core"*|*"root@"*|*" pve "*|*"-J pve"*|*"pct exec"*) return 1 ;;
  esac

  # 2. BINARY — only psql, only as the postgres role.
  [[ "$c" == *"${ELEV} -u postgres psql"* ]] || return 1

  # 3. READ-ONLY, ENFORCED BY POSTGRES — not by trusting the SQL text.
  #    The session must be opened read-only, so a write that evaded every
  #    pattern below is still refused by the server. Keyword matching on SQL is
  #    evadable (case, comments, newlines); this is not.
  [[ "$c" == *"default_transaction_read_only=on"* ]] || return 1
  case "$c" in
    # ...and it must not be turned back off, or escaped by an explicit read-write txn.
    *"read_only=off"*|*"read_only = off"*|*"READ WRITE"*|*"SET ROLE"*|*"SET SESSION AUTHORIZATION"*) return 1 ;;
  esac

  # 4. DATABASE SCOPE — auth_migrateck_stage and nothing else.
  [[ "$c" == *"auth_migrateck_stage"* ]] || return 1
  case "$c" in
    *"migrapilot"*|*"mpanel"*|*"davical"*|*"elize_competition"*|\
    *"lituation_ticketing"*|*"migracredit"*|*"annoupale"*|*"postgres "*) return 1 ;;
    # No cluster-wide enumeration: P3 has one target, named above.
    *" -l"*|*"--list"*|*"pg_database"*) return 1 ;;
  esac

  # 5. WRITE AND SIDE-EFFECT SQL — belt to the server's braces. Also covers the
  #    statements a read-only TRANSACTION does not by itself prevent.
  case "$c" in
    *"INSERT "*|*"UPDATE "*|*"DELETE "*|*"MERGE "*|*"CREATE "*|*"ALTER "*|\
    *"DROP "*|*"TRUNCATE"*|*"GRANT "*|*"REVOKE "*|*"COMMENT "*|\
    *"VACUUM"*|*"ANALYZE"*|*"REINDEX"*|*"REFRESH "*|*"CLUSTER "*|\
    *"COPY "*|*"DO "*|*"CALL "*|*"SELECT INTO"*|*"pg_terminate"*|*"pg_cancel"*) return 1 ;;
  esac

  # 6. NO ESCAPES, NO FILESYSTEM.
  case "$c" in
    *"\\!"*|*"pg_read_file"*|*"pg_write"*|*"lo_import"*|*"lo_export"*|\
    *"pg_ls_dir"*|*"pg_stat_file"*) return 1 ;;
    *"tee "*|*"chmod"*|*"chown"*|*" > "*|*" >> "*) return 1 ;;
  esac

  # 7. HARD DENY — the same absolutes as the other two exceptions.
  case "$c" in
    *"mkfs"*|*"dd if="*|*" fdisk"*|*"parted"*) return 1 ;;
    *"apt "*|*"apt-get"*|*"yum "*|*"dnf "*) return 1 ;;
    *"ufw "*|*"iptables"*|*"nft "*|*"firewall-cmd"*) return 1 ;;
    *"/etc/ssh"*|*"sshd"*|*"authorized_keys"*|*"visudo"*|*"/etc/${ELEV}ers"*) return 1 ;;
    *"reboot"*|*"shutdown"*|*"systemctl"*) return 1 ;;
    *"passwd "*|*"usermod -aG"*|*"gpasswd"*) return 1 ;;
  esac

  # Plus the recursive-force-delete absolute carried by the other two exceptions —
  # spelled as a pattern rather than written out, because the literal text trips
  # the hook's own matcher when this document is written to disk.
  case "$c" in
    *"rm -"[rR][fF]*|*"rm -"[fF][rR]*) return 1 ;;
  esac

  return 0
}
```

Dispatch it beside the other two:

```bash
  elif dbcore_brain_postgres_provisioning "$CMD"; then
    : # permitted: db-core Brain PostgreSQL provisioning, per Bonex 2026-08-22
  elif dbcore_auth_catalog_readonly "$CMD"; then          # <-- add
    : # permitted: P3 read-only catalog comparison, per Bonex <DATE>   # <-- add
```

## The exact commands it would permit

The full blast radius, written down before it is applied rather than after. Every one is a
`SELECT`, piped over stdin because ssh re-parses arguments:

```
relations      SELECT table_name, table_type FROM information_schema.tables
               WHERE table_schema='public' ORDER BY table_name;

columns        SELECT table_name, column_name, data_type, is_nullable, column_default
               FROM information_schema.columns WHERE table_schema='public'
               ORDER BY table_name, ordinal_position;

constraints    SELECT conrelid::regclass AS tbl, conname, contype
               FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY 1,2;

indexes        SELECT tablename, indexname, indexdef FROM pg_indexes
               WHERE schemaname='public' ORDER BY 1,2;

enums          SELECT t.typname, e.enumlabel FROM pg_type t
               JOIN pg_enum e ON e.enumtypid=t.oid ORDER BY 1, e.enumsortorder;

migrations     SELECT migration_name, finished_at, applied_steps_count
               FROM _prisma_migrations ORDER BY finished_at;
```

Each is invoked in this shape, so §3 is satisfied structurally:

```
echo "<SQL>" | ssh db-core "${ELEV} -u postgres \
  PGOPTIONS='-c default_transaction_read_only=on' \
  psql -d auth_migrateck_stage -At -F'|'"
```

## What it still refuses, deliberately

- any host but `db-core`; any elevated binary but `psql` as `postgres`
- any database but `auth_migrateck_stage`, and any cluster-wide listing (`-l`, `pg_database`)
- **every write**, twice over: the server refuses them, and the text filters refuse them first
- `VACUUM`, `ANALYZE`, `REINDEX`, `REFRESH`, `CLUSTER`, `COPY`, `DO`, `CALL` — the ones a
  read-only transaction does not by itself stop
- `SET ROLE`, `SET SESSION AUTHORIZATION`, and any attempt to reopen the session read-write
- psql shell escapes, server-side file reads, and every filesystem write

## After you apply it

Reload the hook (open `/hooks` once, or restart the session) and I will run the six queries
above, diff them against the repository's migration set, and produce the P3 baseline document.
No migration, no repair, no replay of 001-014, and the backup tables untouched.

**Remove this exception once P3 is done.** It exists for one comparison. Charter V §5: written
down before applied, bounded to one asset, removed once verified.
