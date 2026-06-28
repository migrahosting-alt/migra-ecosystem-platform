> Curated from confirmed operational memory as of 2026-06. Verify specifics before acting.

# Canonical Sources & Repo Traps

For each system: where the REAL source lives, and the trap that wastes time or breaks prod. The recurring theme: **the deployed source-of-truth is frequently ON-HOST or on a non-obvious branch — not the local checkout or `origin/main`.**

## MigraHosting Client Portal (`/client`)
- **Canonical:** branch **`client-portal/canonical`** on `github.com/migrahosting-alt/MigraHosting_Marketing` (cut from `auth-cutover-clean-package`, NOT `origin/main`). Portal in `apps/website/src/client/`. Build `vite build --base=/client/`.
- **Traps:** `origin/main` is the **marketing site only** (no portal). `apps/migra-panel` is a DIFFERENT divergent app — its chunk names don't match the live bundle. Verify lineage by content-hashed asset filename, not by matching UI strings. Legacy login is the **production default**; central auth is flag-gated (`VITE_CLIENT_PORTAL_CENTRAL_AUTH_ENABLED`) — keep unset in prod. Pushes from the dev box are sandbox-blocked; publishing goes through the on-host wrapper.

## MigraPanel panel-api
- **Canonical:** ON-HOST `migrapanel-core:/opt/MigraPanel/apps/panel-api/src` (tsx, edited in place, NOT git, ~84 routes incl. on-host-only MigraPay).
- **Trap:** local `dev/New Migra-Panel` (~46 routes) and `.scratch/migrapanel` (~11 routes) are DIVERGENT stale codebases — deploying them caused a prod outage. Never treat them as prod.

## MigraTeck Console (apps/web `/console/*`)
- **Canonical:** `migrahosting-alt/MigraTeck-web` (the `web` remote), same file paths as the monorepo. Prod runs from atomic releases on app-core.
- **Trap:** `MigraTeck-web@main` has DIVERGED from the monorepo `main` (~17 ahead / 25 behind, ~300 files). Basing a console branch on the **monorepo** main and PRing `base=main` on MigraTeck-web balloons the PR (PR #27 hit 352 files for a 4-file change). **Rule:** `git fetch web && git switch -c <branch> web/main`, apply just the change, PR `base=main`. `origin` = `migra-ecosystem-platform` (stale, predates the web app) — not a console target. `core` = behind self-hosted mirror.

## AnnouPale (Pale)
- **Canonical:** nested git `apps/pale-platform` → `github.com/migrahosting-alt/annoupale` (`gh --repo migrahosting-alt/annoupale`). Reconciled backend lives on branch `reconstruct/stable-from-stash`.
- **Traps:** the **local checkout is severely stale** vs origin (a local tip can be dozens of commits + a whole architecture behind `origin/<base>`); the working tree carries hundreds of uncommitted files. Always `git fetch` and diff `origin/<base>` first; build/PR from a **worktree off the origin tip**. `git push`/`gh` need the sandbox disabled. Web standalone: never build from a symlinked-node_modules worktree (see ops hazards #5).

## pale-api backend
- **Canonical:** committed source on `reconstruct/stable-from-stash` (builds clean + matches deployed runtime as of `d00fd42`/later; cutover 2026-06-17). Prod = `app-core:/opt/pale/backend` (now symlinked to a git-faithful build).
- **Trap:** prod historically ran ~33 uncommitted `.ts` (calls/live/notifications) + uncommitted `packages/shared/src/*` — clean builds failed on "callers without callees." Validate in a CLEAN worktree off `origin/reconstruct/stable-from-stash` with fresh `prisma generate`, NOT the dirty deployed `Software/Pale` tree.

## MigraMail backends
- **Canonical (intended):** `migrahosting-alt/MigraMail`, branch `feat/migramail-web-app` (panel backend builds cleanly via `build:panel`).
- **Trap:** the **standalone webmail backend** (`/opt/migramail-web-backend`, dist-only) runs **uncommitted** MigraDrive/billing code that exists on no branch, stash, or archive. Some files (`billing.ts`, `driveAuth.ts`, migrations 013-015) match prod; others (`drive.ts`, `routes/auth.ts`, etc.) are newer than prod. Don't commit working-tree files as "reality" without verifying against the running dist.

## Central auth / staging-auth web
- **Canonical:** ON-HOST `app-core:/opt/migra/repos/migrateck-auth-stage/app/apps/{auth-web,auth-api}/` (deployed == source).
- **Trap:** local `dev/MigraTeck/apps/auth-web` is DIVERGENT (carried a branding block the on-host source lacked). Branding is client-side (reads `window.location`) so it can't be verified by server `curl`. auth-api `.env` in the WorkingDir holds a DEV DB URL — source `/etc/migrateck/auth-api-stage.env` first so Prisma hits prod.

## MigraPay billing
- **Canonical:** billing lives in the **auth-api Prisma 7 schema** @ `AUTH_DATABASE_URL` (`auth_migrateck_stage` on db-core), NOT in billing-core's standalone DB (which is orphaned). Stripe secrets on auth-api only. Panel proxies via `fetchMigraPayBillingInternal` behind `MIGRAPAY_PAYMENT_METHODS_PROXY_ENABLED` + a tenant allowlist (pilot = Elize).
- **Trap:** several billing handler edits (webhook redaction, renewal outcomes) were made ON-HOST and are NOT yet in the billing-core repo — propagate before any wholesale deploy.

## MigraCMS Enterprise
- **Canonical:** `migracms-enterprise/` own nested git (gitignored from the parent dev repo); DB `migracms` (`migracms-postgres` :5440) is the data source of truth; schema `packages/database/prisma/schema.prisma`.
- **Trap:** the product is **MigraCMS**, not "MigraBuilder" — a `MigraBuilder/` repo is a feature SOURCE to port in, NOT a separate product/runtime/domain to deploy. For Compassion site edits, prefer CMS/DB edits over hardcoded source edits.

## General repo facts
- `apps/pilot-web/*` (MigraPilot) is gitignored by the dev-root `.gitignore` (`*` allowlist) → new runtime files need `git add -f`. Same `*`-gitignore breaks Tailwind v4 source detection for MigraStock/TAP (fixes: local `git init` / explicit `@source`).
- Agent `git push`/`gh` are hook-blocked (`.claude/hooks/block-dangerous.sh`) — the user pushes manually.
