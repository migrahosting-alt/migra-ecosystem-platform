> Curated from confirmed operational memory as of 2026-06. Verify specifics before acting.

# Operational Hazards (read before acting)

These are confirmed landmines, each tied to a real incident. An ops brain MUST know them before any deploy/restart.

## 1. voip-core: never `fwconsole restart`
`fwconsole restart` can spawn **two Asterisk processes** (systemd `asterisk.service` vs FreePBX's `safe_asterisk`). The second can't bind UDP transports (`5060`/`5080`) → Telnyx trunk drops, `PJSIP/201` unreachable (WS/WSS/TLS survive — that asymmetry is the tell). Caused a ~5-min PBX outage (2026-05-22).
- **Use the safe wrapper:** `/usr/local/sbin/voip-asterisk-restart` (gates on 0 active calls, stops asterisk, sweeps orphans, confirms ports free, starts, verifies transports/Telnyx/201/queue).
- Policy: Asterisk process restart → ONLY the wrapper. `fwconsole restart` = FORBIDDEN. `fwconsole reload` (config only) = allowed. Never mix `fwconsole` start/stop with `systemctl` for Asterisk.

## 2. Web deploy build-integrity guard
A green health gate (HTTP 200 / PM2 online) proves the server runs, NOT that the correct bytes shipped. Concurrent `build:web`/`next build` racing one `.next` dir → stale/partial static set rsync'd silently (PR #67, 2026-06-11).
- Quiesce all builds (`pgrep -af "next build|build:web"`), build clean, record local `BUILD_ID`, deploy only that, then verify **live `BUILD_ID` == local** and (for CSS/static PRs) the deployed chunk contains the expected selector/hash.

## 3. No broad deploys with a dirty tree
Working-tree deploy scripts build whatever is on disk — a "ship just my commit" deploy can silently ship 20+ unrelated files and unapplied migrations (2026-05-27).
- Scope `git status` to touched dirs first; stash unrelated work or defer; work in isolated sections. "Ship everything" must be an explicit user choice.

## 4. panel-api source-of-truth = ON-HOST (don't deploy local repos)
Deploying local `New Migra-Panel/index.ts` onto `/opt/MigraPanel` (trusting a wrong byte-identical diff) referenced a route absent in prod → crash-loop `ERR_MODULE_NOT_FOUND` → prod outage (2026-06-19), and the overwrite had no backup. ALWAYS back up each on-host file first; a green health gate ≠ correct lineage. If a diff says local==prod, double-check route counts + a known-recent feature (MigraPay) before trusting it.

## 5. AnnouPale web standalone symlink hazard
Building the AnnouPale **web** standalone from a worktree whose `node_modules` is a **symlink** ships a dangling link → `annoupale-web` crash-loops `Cannot find module 'next'` (deploy.sh still exits 0 — check `pm2 list` for `errored`). Also: Next's standalone tracer omits some transitive deps (e.g. `scheduler`), so `rsync --delete` of `.next/standalone/` alone leaves web broken.
- Deploy web only from a checkout with a **real** `node_modules` (`npm ci`). Recovery: `rm` the dangling link, `rsync -azL` the real node_modules, `pm2 restart annoupale-web`.

## 6. FreePBX: never duplicate `[endpoint]` sections
Adding a full duplicate `[201]` / any `type=endpoint` to FreePBX pjsip custom files → Asterisk sorcery rejects `duplicate object` and **silently retains the stale in-memory object** → config changes never take effect. Use the FreePBX `sip` table + `(+)` append syntax only.

## 7. Never use a customer tenant as a test target
Real synthetic FCMs were once sent to **Elize Foundation** (real customer, org `01f24ddb-…`) and a dial placed to their DID. Default test tenant/DID/device in ANY smoke script must be a MigraTeck/MigraHosting-owned one. Internal voice test tenant: **MigraHosting** `861d7119-…`, DID `+18775455428`, login `admin@migrahosting.com`, device S20 `R5CN3008Y1B`. A customer tenant may be used only with explicit, coordinated, documented sign-off.

## 8. Stale Tailscale IP in configs (502 outage)
identity-service `.env` `CONTROL_BASE_URL` pointed at a **dead** `100.119.105.93:3020` → every password login hung 8s → `502`. Fix was repointing to `http://10.10.0.7:3020/api`. Prefer LAN `10.10.0.7` / TS `100.68.175.27` for panel-api; treat `100.119.105.93` as suspect.

## 9. Provisioning worker must be restarted after editing its file
`migrapanel-provisioning-worker.service` loads worker code into memory — restarting panel-api alone is NOT enough. The two MigraPay auto-provision kill-switches (`MARKETING_ORDER_AUTOPROVISION`, `MIGRAPAY_ORDER_BRIDGE_ENABLED`) are **both OFF** — never flip without explicit approval.

## 10. Stale Prisma client after migrations (MigraCMS / dev)
A running `next dev`/server holds a STALE Prisma client after `prisma migrate` → new-model routes return 500 until the server is restarted. Restart the dev/app process after any migration.

## 11. Cookie clear must match Set path/domain (logout bugs)
Next.js cannot emit two `Set-Cookie` with the same name in one response (it keeps the last). Clear a session cookie at the exact `Path`/`Domain` it was set with (console session at `Path=/console`; identity `migra_sess` at `Domain=.migrahosting.com`) or logout "just refreshes."

## General gating rule
Pause for explicit approval before: prod deploys, DNS changes, billing changes, rotating/revoking prod keys, modifying prod DBs, sending live customer comms, and any irreversible external action. Agent `git push` is hook-blocked — the user pushes.
