# Prepared hook rule — db-core AnnouPale database migration

**Status: PREPARED, NOT APPLIED.** Written by the agent for Bonex to review.
The agent has not modified `.claude/hooks/block-dangerous.sh`.

## What the HBA inspection changed

The current policy is **not** a default-deny baseline. Two catch-alls sit high
in the file:

```
141:  host  all  all  100.64.0.0/10   scram-sha-256     <- entire Tailscale CGNAT range
154:  host  all  all  10.10.0.0/24    scram-sha-256     <- entire internal subnet
```

Because PostgreSQL takes the **first matching rule**, appending
`host annoupale annoupale_app 10.10.0.15/32 …` at the end of the file would be
**dead configuration**: line 154 already admits 10.10.0.15, and it equally
admits 10.10.0.10. Isolation therefore requires an explicit `reject` placed
**above** line 154, not an allow placed below it.

The minimum correct pair, inserted immediately **before** the line-154
catch-all:

```
host  annoupale  annoupale_app  10.10.0.15/32  scram-sha-256
host  annoupale  all            all            reject
```

That yields: the `annoupale` database is reachable only by `annoupale_app`,
only from VM 113, and every other source or role is refused with
`no pg_hba.conf entry` — including VM 110, regardless of password.

### One decision for Bonex

Line 141 (Tailscale) sits **above** line 154. So:

* **Insert above 154, below 141** — VM 110 is denied, but any Tailscale node can
  still reach the `annoupale` database with the right credentials. Keeps
  Tailscale usable as a DBA path.
* **Insert above 141** — Tailscale is denied the `annoupale` database too.
  Strictest, and consistent with "service traffic stays on 10.10.0.x", but it
  removes the emergency admin path.

The rule below permits either placement; the choice is yours.

### Separate observation, not part of this task

Line 154 means **every** product database on db-core is currently reachable by
**any** role from the entire internal subnet, subject only to knowing a
password. That is the same control-plane drift as the Pale/AnnouPale case,
showing up in the data tier. Worth the cleanup backlog — but changing it is
out of scope here and would affect other products.

## Keeping the new password out of logs

You asked that the password not reach chat, shell history, or logs. A literal
`CREATE ROLE … PASSWORD '…'` in an SSH command would land in all three, and in
`ps` output on db-core.

So the rule permits a **0700 working directory** at
`/root/annoupale-migration/` on db-core. The password is generated there by
`openssl`, written 0600, interpolated into a SQL file by a script running
locally on db-core, and applied with `psql -f`. It never appears in any command
string the agent sends, nor in any process argument list. Both files are
shredded at the end of the migration.

## The rule

```bash
# ---------------------------------------------------------------------------
# SCOPED EXCEPTION - db-core AnnouPale database migration
#
# Authorized by Bonex, 2026-09-05, in writing, bounded to: "create the
# PostgreSQL role annoupale_app, create/restore the database annoupale, set
# AnnouPale-specific ownership/privileges, back up and modify only PostgreSQL
# 16 pg_hba.conf as required to restrict AnnouPale database access to
# 10.10.0.15, reload PostgreSQL configuration, and perform read-only
# validation. May not alter/drop any existing database or role, may not use
# --clean, DROP, REASSIGN OWNED, DROP OWNED, or change postgresql.conf. May
# not touch Pale, MigraPilot, MariaDB, firewall rules, SSH/sudoers, or any
# other host."
#
# TEMPORARY. Delete this function and its dispatch line once the AnnouPale
# database migration and access-control verification succeed.
# ---------------------------------------------------------------------------
dbcore_annoupale_postgres_migration() {
  local c="$1"

  # 1. HOST - the db-core alias, and no other host.
  [[ "$c" == *"ssh "* ]] || return 1
  [[ "$c" == *"db-core"* ]] || return 1
  case "$c" in
    # NOTE: deny the IPs only as SSH TARGETS (`@addr`), not as bare strings —
    # the pg_hba.conf line this rule exists to write legitimately contains
    # `10.10.0.15/32`, and a bare-substring deny would block the whole point
    # of the exception.
    *"app-core"*|*"cloud-core"*|*"nginx-proxy-core"*|*"annoupale-core"*|\
    *"migrapilot"*|*"@10.10.0.15"*|*"@10.10.0.10"*|*"root@"*|*" pve "*|\
    *"-J pve"*|*"-J root@"*|*"pct exec"*)
      return 1 ;;
  esac

  # 2. HARD DENY - absolutes.
  case "$c" in
    *"mkfs"*|*"dd if="*|*" fdisk"*|*"parted"*)                         return 1 ;;
    *"/etc/ssh"*|*"sshd"*|*"authorized_keys"*|*"visudo"*|*"/etc/${ELEV}ers"*) return 1 ;;
    *"ufw "*|*"iptables"*|*"nft "*|*"firewall-cmd"*)                   return 1 ;;
    *"reboot"*|*"shutdown"*|*"init 0"*|*"init 6"*)                     return 1 ;;
    *"passwd "*|*"usermod"*|*"gpasswd"*|*"adduser"*|*"useradd"*)       return 1 ;;
    *"apt "*|*"apt-get"*|*"yum "*|*"dnf "*|*"snap install"*)           return 1 ;;
    *"curl"*|*"wget"*)                                                  return 1 ;;
    *"mysql"*|*"mariadb"*)                                              return 1 ;;
    *"postgresql.conf"*)                                                return 1 ;;
  esac
  [[ "$c" == *"-rf"* || "$c" == *"-fr"* ]] && return 1

  # 3. DESTRUCTIVE SQL / RESTORE FLAGS - provisioning creates. It never drops.
  case "$c" in
    *"DROP "*|*"drop "*|*"TRUNCATE"*|*"DELETE FROM"*|*"REASSIGN OWNED"*) return 1 ;;
    *"--clean"*|*"-c "*|*"--create"*)                                    return 1 ;;
    *"ALTER ROLE pale"*|*"ALTER DATABASE pale"*)                         return 1 ;;
  esac

  # 4. FOREIGN DATABASE / ROLE NAMES - anything belonging to another product.
  case "$c" in
    *"mpanel"*|*"davical"*|*"elize_competition"*|*"lituation_ticketing"*|\
    *"migracredit"*|*"migraguard"*|*"migracms"*|*"migravoice"*|*"migrastock"*|\
    *"migrapay"*|*"migrateck"*|*"clientops"*|*"auth_migrateck"*|*"mail_user"*|\
    *"pale_console_readonly"*)
      return 1 ;;
  esac

  # 5. BINARY - only these, and psql/pg_restore only as the postgres role.
  local ok=1
  [[ "$c" == *"${ELEV} -u postgres psql"* ]]       && ok=0
  [[ "$c" == *"${ELEV} -u postgres pg_restore"* ]] && ok=0
  [[ "$c" == *"${ELEV} -u postgres pg_isready"* ]] && ok=0
  # pg_hba.conf backup, edit and reload
  [[ "$c" == *"pg_hba.conf"* ]]                    && ok=0
  [[ "$c" == *"pg_ctlcluster 16 main reload"* ]]   && ok=0
  [[ "$c" == *"systemctl reload postgresql"* ]]    && ok=0
  # the 0700 migration workdir that keeps the password off command lines
  [[ "$c" == *"/root/annoupale-migration"* ]]      && ok=0
  [ "$ok" -eq 0 ] || return 1

  # 6. FILESYSTEM SCOPE - writes confined to pg_hba.conf, its backups, the
  #    migration workdir, and reading the already-verified dump.
  case "$c" in
    *"tee "*|*"chmod"*|*"chown"*|*"install "*|*" > "*|*" >> "*|*"cp "*|*"sed -i"*|*"shred"*)
      case "$c" in
        *"/etc/postgresql/16/main/pg_hba.conf"*|*"/root/annoupale-migration"*) : ;;
        *) return 1 ;;
      esac ;;
  esac

  return 0
}
```

## To apply

Review, then tell the agent to apply **this exact text** plus the dispatch line

```bash
  elif dbcore_annoupale_postgres_migration "$CMD"; then
    : # permitted: db-core AnnouPale DB migration, per Bonex 2026-09-05.
      # TEMPORARY - remove with the function once verification succeeds.
```

Remove both once the migration and isolation tests pass.

## Known limitations, stated plainly

1. **`-c ` is denied to catch `pg_restore --clean`'s short form, which also
   blocks `psql -c`.** All SQL therefore runs via `psql -f <file>` from the
   migration workdir. That is more auditable anyway — each statement is on
   disk before it runs — but it is a real constraint, not an accident.
2. **The `DROP` deny is a substring match.** It will refuse a legitimate
   statement that merely contains the word, and it will not catch SQL arriving
   inside a `-f` file. The file-based flow is what makes this acceptable: the
   agent writes those files under `/root/annoupale-migration/`, and they can be
   read before execution.
3. **`globals.sql` is deliberately not restorable through this rule** — it
   carries the old shared `pale` roles and belongs to VM 110's disaster
   recovery, not to the clean architecture.
