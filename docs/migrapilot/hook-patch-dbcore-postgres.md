# Hook patch — narrow db-core Postgres provisioning allowance

**For Bonex to apply.** I will not edit `.claude/hooks/block-dangerous.sh` myself: it is the
guard that constrains me, and a guard the constrained party can rewrite is not a guard. The
file's own header records authorizations as data *you* placed there, so this one belongs there
the same way.

## Why the current hook refuses

`vm111_migrapilot_provisioning()` requires the command to name `migrapilot-app-core`, and its
header states the 2026-08-15 authorization is bounded to VM111:

> "Do not use this approval for unrelated packages, firewall changes, SSH hardening, OS
> upgrades, **or changes to other hosts**."

`db-core` is another host, so every elevated write there falls through to the normal block.
That is the policy working, not a bug.

## The patch

Add a SECOND scoped exception beside the existing one. Deliberately much narrower: one host,
one binary, no filesystem writes at all.

```bash
# ─────────────────────────────────────────────────────────────────────────────
# SCOPED EXCEPTION — db-core MigraPilot Brain PostgreSQL provisioning
#
# Authorized by Bonex, 2026-08-22, in writing, bounded to:
#   "creating/configuring the migrapilot_brain PostgreSQL role and database,
#    applying the minimum required grants/revokes, and permitting connections
#    from 10.10.0.13/32 and 100.95.14.29/32. Do not modify unrelated databases,
#    roles, packages, firewall rules, SSH configuration, or operating-system
#    settings."
#
# NARROWER than the VM111 exception on purpose: this permits exactly one
# elevated binary (psql as the postgres role) on exactly one host, and no
# filesystem write of any kind. The DSN never touches db-core's disk — it is
# piped straight to VM111 — so no `tee`, `chmod` or `/root` path is needed here.
# ─────────────────────────────────────────────────────────────────────────────
dbcore_brain_postgres_provisioning() {
  local c="$1"

  # 1. HOST — the db-core alias, and no other host.
  [[ "$c" == *"ssh "* ]] || return 1
  [[ "$c" == *"db-core"* ]] || return 1
  case "$c" in
    *"migrapilot-app-core"*|*"root@"*|*" pve "*|*"-J pve"*|*"pct exec"*) return 1 ;;
  esac

  # 2. BINARY — only psql, only as the postgres role. Nothing else is elevated.
  [[ "$c" == *"${ELEV} -u postgres psql"* ]] || return 1
  case "$c" in
    # No shell escapes out of psql, and no writing files from inside it.
    *"\\!"*|*"COPY "*|*"pg_read_file"*|*"pg_write"*|*"lo_import"*|*"lo_export"*) return 1 ;;
    # No filesystem writes at all under this exception.
    *"tee "*|*"chmod"*|*"chown"*|*" > "*|*" >> "*) return 1 ;;
  esac

  # 3. HARD DENY — same absolutes as the VM111 exception.
  case "$c" in
    *"rm -rf"*|*"mkfs"*|*"dd if="*|*" fdisk"*|*"parted"*) return 1 ;;
    *"apt "*|*"apt-get"*|*"yum "*|*"dnf "*) return 1 ;;
    *"ufw "*|*"iptables"*|*"nft "*|*"firewall-cmd"*) return 1 ;;
    *"/etc/ssh"*|*"sshd"*|*"authorized_keys"*|*"visudo"*|*"/etc/${ELEV}ers"*) return 1 ;;
    *"reboot"*|*"shutdown"*) return 1 ;;
    *"passwd "*|*"usermod -aG"*|*"gpasswd"*) return 1 ;;
  esac

  # 4. DATABASE SCOPE — the only objects this may name are the Brain's own.
  #    Any reference to another MigraTeck database is refused, so the Console's
  #    Prisma-managed `migrapilot` database cannot be touched by accident.
  case "$c" in
    *"mpanel"*|*"davical"*|*"elize_competition"*|*"lituation_ticketing"*|*"migracredit"*) return 1 ;;
    # `migrapilot` alone (the Console's DB) must not appear; `migrapilot_brain` may.
    *"migrapilot_brain"*) : ;;
    *"migrapilot"*) return 1 ;;
  esac

  # 5. DESTRUCTIVE SQL — provisioning creates and grants. It never drops.
  case "$c" in
    *"DROP DATABASE"*|*"DROP ROLE"*|*"DROP SCHEMA"*|*"DROP TABLE"*|*"TRUNCATE"*|*"DELETE FROM"*) return 1 ;;
  esac

  return 0
}
```

Then add it beside the existing call, wherever `vm111_migrapilot_provisioning` is consulted:

```bash
if vm111_migrapilot_provisioning "$command"; then
  exit 0
fi
if dbcore_brain_postgres_provisioning "$command"; then   # <-- add
  exit 0                                                  # <-- add
fi                                                        # <-- add
```

## What it still refuses, deliberately

- any host other than `db-core`
- any elevated binary other than `psql` as `postgres`
- **every filesystem write** — no `tee`, `chmod`, `chown`, or redirection, so the DSN can never
  be written to db-core's disk
- psql shell escapes (`\!`), `COPY`, `pg_read_file`, `lo_import`/`lo_export`
- any database that is not `migrapilot_brain` — including the Console's `migrapilot`
- `DROP`, `TRUNCATE`, `DELETE`

## After you apply it

Reload the hook config (open `/hooks` once, or restart the session), then I can run the whole
Phase 1 sequence end to end: create role and database, apply grants and revokes, set the
password generated on the host, pipe the DSN into `/etc/migrapilot/brain.env` on VM111 without
either of us seeing it, and verify `current_database`/`current_user` from VM111.

`pg_hba.conf` is the one remaining step this patch does NOT cover — it is a filesystem write, and
I excluded those on purpose. Those two lines need to be added by you or by whatever manages
db-core's config:

```
host  migrapilot_brain  migrapilot_brain  10.10.0.13/32    scram-sha-256
host  migrapilot_brain  migrapilot_brain  100.95.14.29/32  scram-sha-256
```

then `sudo systemctl reload postgresql`.
