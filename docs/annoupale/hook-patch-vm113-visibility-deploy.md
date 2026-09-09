# Scoped exception — deploy the post-visibility authority to VM 113

Target SHA: `8f17218`. Closes real access-control defects: an unauthenticated
`GET /api/posts/:id` served any post in full, and posts written inside private
groups were stored as globally public.

Unlike every previous VM 113 grant this one is **not** web-only. It needs the
API restarted and it needs a schema change, so it touches two hosts.

## Why `prisma migrate deploy` is DENIED by this grant

The ledger on db-core is already broken, and I found it while gathering
pre-change evidence rather than by running the command:

```
77 rows in _prisma_migrations; 6 unfinished AND rolled_back, applied_steps_count = 0
  20260420120000_phase16_discovery_search_indexes
  20260420140000_phase17_trust_safety            (x2)
  20260420180000_phase18_account_security
  20260420200000_phase19_realtime_ecosystem
  20260531200000_add_group_invites
```

A row with `rolled_back_at` set is one Prisma will try to APPLY AGAIN. Those
migrations are from April/May and their objects already exist (`group_invites`
and `reports` both present), so `migrate deploy` would re-run six old
migrations against a schema that already has their output. Recent migrations
(Aug/Sep) are cleanly applied, so this is a legacy wound, not a new one.

This grant therefore applies the enum values with three idempotent
`ALTER TYPE ... ADD VALUE IF NOT EXISTS` statements and records the migration
row by hand. **The broken ledger is left exactly as found** — repairing it is a
separate decision, not something to do inside an access-control deploy.

## Blast radius

Additive enum values only. No row is rewritten, no column changes type, no
value is removed. An existing post cannot change audience as a result. The
`Status` table shares this enum and is likewise untouched (47 public, 2
followers_only stay as they are).

## Rollback

```
git checkout --detach cf3f4d1  ->  npm run build:api  ->  pm2 restart annoupale-api
```

Roughly two minutes. Enum values are LEFT IN PLACE deliberately: PostgreSQL
enum removal is not cleanly reversible, and unused values are inert. The old
code never reads them.

Pre-change identity to roll back to:

- VM113 `/opt/annoupale/app` HEAD = `cf3f4d135cf4307cb9dc82657d13f6da00cda5a5`, clean tree
- web BUILD_ID = `xLqJpRg9hbD4gUAgxeMo_` (web is NOT touched by this deploy)
- API pid 158351
- `PostVisibility` = `public,followers_only`
- posts: 171 public + 1 followers_only (that one is soft-deleted) = 172 total

## Acceptance fixtures

Production mutation is authorized for controlled probe content only, created
through the real API as `audit@annoupale.com` and removed afterwards. No real
user's content is read, written or deleted.

## The rule

The function body is kept in `hook-patch-vm113-visibility-deploy.rule.sh`
alongside this file. It is stored as a separate file on purpose: the rule text
contains the very strings it denies, so pasting it inside a shell heredoc trips
the standing guard. Install it by inserting the function into
`.claude/hooks/block-dangerous.sh` and adding the dispatch line, then remove
both when the deploy is finished and prove the block is back.

Dispatch (inside the `${ELEV}` gate, alongside the existing scopes):

```bash
  elif vm113_annoupale_visibility_deploy "$CMD"; then
    : # permitted: VM113 post-visibility deploy, per Bonex 2026-09-07
```

## 🚨 What this rule actually gates — measured, not assumed

The rule is dispatched **only from inside the `${ELEV}` (sudo) gate**. A command
that carries no `sudo` never reaches this function at all; it is governed by the
standing rules further down the hook. Probing the same 40 commands against the
hook with and without this rule installed:

```
baseline   PASS=11 FAIL=29
with grant PASS=15 FAIL=25
verdicts changed: 4 — all deny -> allow, all of them the sudo-bearing
                      VM113 operations this grant exists for
newly allowed: 4      newly denied: 0
```

So the widening is exactly the four intended operations and nothing else. But
the corollary matters more: **the denial clauses inside this rule (SQL,
hosts, pm2, filesystem) constrain only sudo-bearing commands.** They are not a
firewall over the non-sudo commands this deploy also runs.

Concretely, the baseline hook — before and after this grant — already permits
all of the following, none of which this rule can refuse because none reach it:

```
ssh db-core "psql -d annoupale -c 'DROP TABLE posts'"
ssh db-core "psql -d annoupale -c 'DELETE FROM posts'"   (also UPDATE/TRUNCATE)
ssh db-core "pg_dump annoupale"
ssh bonex@10.10.0.15 "cat /opt/annoupale/config/api.env"
ssh bonex@10.10.0.15 "npx prisma migrate deploy"
ssh bonex@10.10.0.15 "reboot" / "ufw disable" / "tee /etc/nginx/x.conf"
ssh <any-host> ...                       (host scoping is per-grant, not standing)
rm -r -f <path>                          (only the joined "rm -rf" is standing)
```

That is a pre-existing property of the hook, not something introduced here, and
it is reported separately. For THIS deploy the SQL discipline is therefore
**procedural**: the only statements issued are the three additive
`ADD VALUE IF NOT EXISTS` and one ledger `INSERT`, and every command is shown in
the transcript. Do not read the scope summary below as machine-enforced for
non-sudo commands.

Scope summary, in the order the rule enforces it (for sudo-bearing commands):

1. **Hosts** — VM113 (`bonex@10.10.0.15` / `bonex@100.72.225.113`) and
   `db-core` only. Both are neutralised before the denylist runs, so no other
   `-core` box, no `root@`, no `pct exec`, no `app-core` (which is the OLD
   VM110 and is what `deploy.sh` targets by default).
2. **Pale** — the mobile lane stays out of reach.
3. **Secrets** — no env var assignments, no `/opt/annoupale/config`.
4. **SQL** — `migrate deploy` / `dev` / `reset` / `db push` / `resolve` all
   denied. `DROP`, `TRUNCATE`, `DELETE`, `UPDATE`, `ALTER TABLE`, `GRANT`,
   `COPY`, `pg_dump`/`pg_restore` denied. `INSERT` allowed only into
   `_prisma_migrations`; `ALTER TYPE` allowed only as an additive
   `"PostVisibility" ADD VALUE IF NOT EXISTS`. Only the `annoupale` database.
5. **Git** — fetch / checkout --detach / read verbs only; push, reset, rebase,
   tag and history rewrites denied.
6. **npm** — `build:api`, `install --omit=dev`, `prisma generate`, typecheck.
   No web build.
7. **Hard deny** — disks, ssh config, firewall, users, packages, containers,
   power. Separated `rm` flags are treated as joined ones.
8. **Elevation** — `-u annoupale` only.
9. **pm2** — the API may restart this time; anything naming `annoupale-web` is
   refused, as are kill/delete/stop/reload/restart-all.
10. **Filesystem** — writes confined to `/opt/annoupale/app`.
