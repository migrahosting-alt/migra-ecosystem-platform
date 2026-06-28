> Curated from confirmed operational memory as of 2026-06. Verify specifics before acting.

# Deploy Models

Each major service has its own (often non-git) deploy mechanism. **Know which one before touching anything.**

## MigraPanel panel-api (migrapanel-core)
- **Source-of-truth = ON-HOST** `migrapanel-core:/opt/MigraPanel/apps/panel-api/src`, runs via **`tsx`**, edited in place, **NOT a git repo** (full of `.bak` files). Prod has ~84 routes incl. MigraPay added on-host that NO local copy has.
- DB: `migrapanel` on db-core (`DATABASE_PANEL_URL`). Live DB uses **dual-cased columns** (snake_case + camelCase both present) — hand-inserting is risky; prefer panel-api routes/logic.
- Service: `migrapanel-panel-api.service` (also `migrapanel-provisioning-worker.service`, `migrapanel-dns-worker.service`).
- Scripted deploy (from a local clone): `bash New\ Migra-Panel/scripts/deploy/panel-api-remote.sh` — rsyncs `apps/panel-api/{package.json,src} packages` via tar-over-SSH, conditional `pnpm install --frozen-lockfile`, optional `tsc --noEmit`, `systemctl restart`, then health-checks `http://127.0.0.1:3020/health` 15×.
- **In-practice safe path:** edit on-host with timestamped backups, restart, health-check `http://10.10.0.7:3020/health`, revert from backup if unhealthy.
- **⚠ DIVERGENCE WARNING:** local `dev/New Migra-Panel` and `.scratch/migrapanel` are **different, stale codebases** (fewer routes, no MigraPay). Deploying them onto `/opt/MigraPanel` caused a prod outage (2026-06-19). NEVER deploy local repos onto panel-api.

## MigraPanel Client Portal frontend (migrapanel-core)
- Canonical source = branch **`client-portal/canonical`** on `migrahosting-alt/MigraHosting_Marketing`; portal under `apps/website/src/client/`.
- Build: `( cd apps/website && yarn vite build --base=/client/ )` → `dist/`.
- Live static: `nginx-proxy-core` serves it; bundle at `migrapanel-core:/opt/MigraPanel/apps/client-portal/`.
- Deploy: `bash scripts/deploy/client-portal-ui.sh` — builds, runs route guard, **backs up remote** to `/opt/MigraPanel/backups/client-portal-<ts>`, rsync `--delete`, verifies index.html asset hash. Rollback = restore the backup dir.
- **⚠** The deployed frontend lives in the working tree mostly untracked vs git; verify lineage by **building + comparing content-hashed asset filenames to the live bundle** before trusting/deploying. `apps/migra-panel` is a DIFFERENT divergent app — NOT the live portal.

## MigraTeck Console (app-core)
- Code: `MigraTeck/apps/web/src/app/console/`. **Console PRs target `migrahosting-alt/MigraTeck-web` via the `web` remote**, NOT `origin` (the monorepo).
- Prod runs via **atomic releases**: `/opt/migra/apps/migrateck/current` → `/opt/migra/releases/migrateck/<ts>-<sha>/`; `migrateck.service` port **3111**, health `/console` → 307.
- Deploy: build a clean `web/main` worktree (on a credentialed box — app-core has NO GitHub creds for the private web repo) → rsync clean source to a fresh release dir → `pnpm install --frozen-lockfile` + `pnpm -F @migrateck/web build` on app-core → repoint `current` symlink → `systemctl restart migrateck`. Rollback = repoint to previous release + restart. Env stays in `/etc/migrateck/*.env`.
- **⚠** Do NOT use `deploy-production.sh` / `npm ci` for the console. Build with the pinned Next binary (16.2.6), not a stale hoisted copy.

## AnnouPale web + api (app-core)
- `/opt/annoupale/{web,api}` are **deploy artifacts, not git checkouts** (no `.git`). Files arrive via `apps/pale-platform/scripts/deploy.sh` from a local clone.
- `scripts/deploy.sh` builds api+web, rsyncs `dist/apps/api`, package/lockfile, `prisma/`, scripts, and the Next standalone; runs `npm install --omit=dev` on host (devDeps like `tsx`/`vitest` absent → use `npx --yes`); **also runs `prisma migrate deploy` + restarts annoupale-api**. PM2: `annoupale-web` (:3101), `annoupale-api` (:3100).
- For a web-only change, mirror deploy.sh's 3 web rsyncs with `-azL` + the node_modules guard — do NOT run full deploy.sh.

## pale-api (app-core)
- Prod `app-core:/opt/pale/backend`, **rsync-deployed (NOT git)**, has `src`+`dist`+`node_modules`. Runs `dist/backend/src/main.js` via PM2 **`pale-api`** (:4005, health `127.0.0.1:4005/api/health`).
- Deploy: build locally (`cd backend && npm run build`), rsync changed compiled `.js` to `dist/backend/src/...` AND the `.ts` to `src/...` (keep consistent), `pm2 restart pale-api --update-env`. Restart ONLY pale-api (annoupale-api/web also on this host).
- As of 2026-06-17, a **workspace-faithful cutover** made pale-api run from committed git source (`reconstruct/stable-from-stash`) via a symlinked build dir under `/opt/pale/builds/`.

## MigraMail backends (nginx-proxy-core)
- **Standalone webmail/Drive backend:** `migramail-web-backend.service` :3010, dir `/opt/migramail-web-backend`, **flat dist-only, no git on host**. Deploy = `scp` compiled `.js` + restart (back up first). Source `migrahosting-alt/MigraMail` branch `feat/migramail-web-app`.
- **Console Mail panel backend:** `migramail-panel-api.service` :3013, dir `/opt/migramail-panel-api`, `node dist-panel/panelServer.js`. Built `npm run build:panel` (scoped tsconfig). Console wiring `MIGRAMAIL_PANEL_API_BASE=http://100.101.106.88:3013`.

## MigraStock (app-core)
- `output:standalone` bundle at `app-core:/opt/migrastock`, systemd `migrastock.service` (binds `100.101.3.99:3220`, tailnet-only). nginx vhost on nginx-proxy-core proxies it. DB `migrastock` on db-core.
- Redeploy: local `npm run build` → copy `.next/static`+`public` into bundle → `rsync -az --delete .next/standalone/` → `systemctl restart migrastock`.

## Central auth / staging-auth (app-core)
- auth-api (central) `10.10.0.10:4120`; staging web `staging-auth.migrateck.com` :4821 (`next start`), systemd `migrateck-auth-web-stage`.
- **Source-of-truth ON-HOST** `/opt/migra/repos/migrateck-auth-stage/app/apps/{auth-web,auth-api}/`; local `dev/MigraTeck/apps/auth-web` is DIVERGENT. Reach via ProxyJump: `ssh -J root@100.101.106.88 root@10.10.0.10`.

## Source-of-truth divergence warnings (summary)
- **panel-api**, **client-portal frontend**, **staging-auth web**, **migramail backends** → deployed source-of-truth is ON-HOST; local repos diverge. Verify before deploy.
- **pale-api** historically ran ~33 uncommitted `.ts` files (now reconciled into `reconstruct/stable-from-stash` and cut over, 2026-06-17). Validate in a clean worktree off origin, never the dirty deployed `Software/Pale` tree.
- **migramail backend** runs uncommitted MigraDrive/billing code that exists on no branch/stash; some files match prod, others are newer — don't commit working-tree files as "reality" without verification.
