# AnnouPale Trust & Operations — Native MigraPanel Module

**Date:** 2026-06-04
**Surface:** MigraPanel Control Center (`https://console.migrateck.com/console`)
**Code:** `MigraTeck/apps/web/src/app/console/`

## Route

- **`/console/annoupale`** — native, in-console AnnouPale Trust & Operations overview.
- Server component, `export const dynamic = "force-dynamic"` (no static prerender; the live web probe runs per request, never at build time).
- Gated by the existing console admin session (`getSession()` → redirect to `/console/login`).

### Reachable from the Ecosystem grid
The AnnouPale product tile now points its **primary "Open"** action at `/console/annoupale`
(was the external admin). Secondary **"Compliance"** still deep-links to the external case queue.

- Overview grid tile: `lib/ecosystem.ts` → `annoupaleTile()`
- Full ecosystem page: `ecosystem/page.tsx` → `ROUTE_FOR.annoupale = "/console/annoupale"`

## Files

| File | Change |
|---|---|
| `src/app/console/annoupale/page.tsx` | New — the module page |
| `src/app/console/lib/annoupale.ts` | New — canonical links + real HEAD web probe |
| `src/app/console/lib/ecosystem.ts` | Tile primary action → `/console/annoupale` |
| `src/app/console/ecosystem/page.tsx` | `ROUTE_FOR.annoupale` → `/console/annoupale` |
| `public/brands/products/annoupale.png` | AnnouPale official mark (added in prior pass) |
| `docs/console/ANNOUPALE_MODULE_2026-06-04.md` | This doc |

## Page content

- **Header:** title `AnnouPale Trust & Operations`, full subtitle, `Operational`/probe status badge, `Production` env badge.
- **Branded hero:** AnnouPale logo + name + live web reachability (HEAD probe latency).
- **Action cards (4):** Open Admin, Compliance Case Queue, Legal Center, Public Intake Forms.
- **Operations cards (4):** Compliance · Safety & Moderation · Platform Health · Legal Readiness.
- **Compliance Status:** Public intake forms = Live · Admin queue = Live · SMTP notifications = Live · Staff-only gating = Enforced by AnnouPale · Counsel review = Pending · Mail TLS monitoring = Recommended.
- **Deep Links (8):** `/admin`, `/admin/compliance/cases`, `/privacy/request`, `/safety/report`, `/security/report`, `/ip/report`, `/appeals`, `/help/account-deletion`.

## Links (all verified to exist in `apps/pale-platform/apps/web`)

All canonical **apex** URLs (`https://annoupale.com`, never `www`):

`/admin` · `/admin/compliance/cases` · `/admin/appeals` · `/legal` · `/legal/contact` ·
`/privacy/request` · `/safety/report` · `/security/report` · `/ip/report` · `/appeals` ·
`/help/account-deletion`

Route existence was confirmed against the AnnouPale source tree (admin pages under
`app/admin/...`, public forms under `app/(marketing)/...`) — no dead links.

## Data honesty

- **No fabricated counts.** The panel has no AnnouPale DB, so the page shows qualitative
  statuses only: `Live` / `Configured` / `Pending` / `Recommended` / `Enforced` / `Not connected yet`.
- **One real signal:** `probeAnnoupaleWeb()` performs a genuine `HEAD https://annoupale.com`
  (4s timeout) and reports `Operational` / `Degraded` / `Unreachable` — failures are honest, not masked.
- Items with no real backend probe (Admin API health, Live/streaming, Moderation queue) are
  explicitly labelled **"Not connected yet"** rather than faked.

## Role / security

- Visibility is controlled by the existing **single-admin console gate** — only the owner/admin can
  reach `/console/*` at all.
- The module is a **deep-link surface only**: no AnnouPale admin iframe, **no tokens in URLs**, and it
  grants **no AnnouPale permission**. Every linked surface still requires the appropriate AnnouPale
  staff role (`platform_admin` / `trust_safety_admin`).
- All external links use `target="_blank"` + `rel="noopener noreferrer"`.

## Validation / QA

- `tsc --noEmit` → **pass** (exit 0).
- `eslint` on changed files → **pass** (exit 0).
- `next build` → **compiled successfully + TypeScript passed**; the new route is `force-dynamic`
  and type-checked. Build's only failure is the **pre-existing, unrelated** `/legal/payment`
  prerender bug (`InvariantError`) in `app/legal/[slug]` — not introduced here and **not fixed in
  this pass** (out of scope; does not affect the console route).
- QA checklist (route loads, enterprise style, logo renders, apex-only links, all CTAs live, no fake
  counts, no dead buttons, grid still works, tile reaches the page, no layout overflow, existing
  modules unchanged) — satisfied by construction; not runtime-clicked in a browser this pass.

## `/legal/payment` build "blocker" — root cause (2026-06-04, deploy pass)

**There is no real code bug.** The `/legal/payment` prerender failure
(`InvariantError: Expected workStore to be initialized`) was an artifact of a
**stale local toolchain**, not the legal route:

- `apps/web` pins **Next 16.2.6**, but a hoisted **16.2.2** copy existed in the
  workspace, and `npx next build` resolved the **16.2.2** binary.
- Next **16.2.2** has a Turbopack production-prerender bug that aborts static
  export on a shared chunk — it surfaced first on `/legal/payment`, and after
  excluding legal it simply moved to `/_global-error` (a pure client component),
  proving it was global to the bundler, not the legal content.
- Building with the **pinned 16.2.6** binary
  (`node ./node_modules/next/dist/bin/next build`) **passes cleanly** — all 50
  pages generate, including every `/legal/*` route and the new
  `/console/annoupale` (ƒ dynamic). No legal code change required.

**Fix applied:** none to legal pages (reverted experimental edits). The deploy
pipeline (`MigraTeck/scripts/deploy-production.sh`) runs `npm ci` before
building, which installs the pinned 16.2.6 — so the pipeline builds green. The
local-only fix is to resync deps (`npm/pnpm install`) so `npx` stops resolving
the stale 16.2.2 binary.

## Deployment (2026-06-04) — DEPLOYED to production

- **Production commit:** `534e36d` (branch `feat/console-foundation` → merged to local
  `main` via fast-forward). Console foundation committed in A `60448a0` / B `eec3dc2` /
  C `523be47` (AnnouPale) / dep `534e36d`.
- **DB migration gate:** `001_client_management` confirmed **already applied** to the prod
  migrapanel DB (2026-05-28); not reapplied.
- **Deployment method (clean, minimal):** app-core's `/opt/migra/repos/migrateck/app` is
  **rsync-fed, not a git checkout**, so the `deploy-production.sh` path (which uses `npm ci`
  and rsyncs the dirty tree) was **not** used. Instead:
  1. Built a clean `main@534e36d` worktree (never the dirty local tree).
  2. Checksum dry-run → confirmed the prod delta is exactly the AnnouPale files
     (`annoupale/page.tsx`, `lib/annoupale.ts`, `lib/ecosystem.ts` tile, `ecosystem/page.tsx`
     route, `lib/modules/stripe-links.ts` comment fix, `annoupale.png`).
  3. `rsync -rlc` (content-only, **no `--delete`**) of `console/` + the logo asset to app-core
     — no unrelated/dirty files transferred.
  4. **Build-only** (`pnpm -F @migrateck/web build`) with prod's existing `node_modules`.
     `pnpm install --frozen-lockfile` was **skipped** because AnnouPale adds no new deps and
     prod has a **pre-existing** `pnpm.overrides`/lockfile mismatch (unrelated to this change —
     see Deferred). Build EXIT 0, `/console/annoupale` present.
  5. `systemctl restart migrateck` → service `active (running)`, no errors in logs.
- **Production QA — server/asset level (verified):**
  - `https://console.migrateck.com/console` → 307 (auth gate, healthy).
  - `https://console.migrateck.com/console/annoupale` → 307 (route live, not 404/500).
  - `https://console.migrateck.com/brands/products/annoupale.png` → 200 `image/png` (logo serves).
  - No `www.annoupale` in served output; source uses apex `https://annoupale.com` only,
    Admin `…/admin`, Compliance `…/admin/compliance/cases`.
  - Server logs clean since restart.
- **Production QA — authenticated visual (PENDING, needs a logged-in browser):** tile appears
  in the Ecosystem Control Grid, tile logo renders, Open → `/console/annoupale`, existing
  modules still present, no dead buttons, no horizontal overflow, browser console clean. I
  could not perform these headlessly (the console is single-admin auth-gated and I do not use
  the admin credential).
- **Not pushed:** local `main` is ahead of `origin/main`; prod is served from the rsync'd
  files, independent of git remote.

## Deferred (explicitly NOT started)

- Orchestration Map AnnouPale node (SVG layout).
- Shared staff SSO / central cross-product RBAC.
- Live AnnouPale metrics (requires an AnnouPale read API / panel data feed).
- Mail TLS monitoring widget.
- Admin API / streaming health probes (need safe AnnouPale health endpoints).
- Pre-existing `/legal/payment` build fix (was a stale-toolchain artifact; clean on Next 16.2.6).
- **Prod dependency drift (ops cleanup):** app-core's `/opt/migra/repos/migrateck/app` is
  rsync-fed (not git) and its `package.json`/`pnpm-lock.yaml` are inconsistent
  (`ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` on `overrides`), plus it carries leftover dirty files
  (Windows-path junk, `packages/auth-*` drift). Frozen-lockfile installs will fail until this
  is reconciled. Recommend converting the prod app dir to a clean git checkout (or a clean
  artifact pipeline) and regenerating a consistent lockfile.
