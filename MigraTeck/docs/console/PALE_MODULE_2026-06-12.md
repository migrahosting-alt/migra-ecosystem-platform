# Pale Module — MigraPanel Control Center

**Date:** 2026-06-12
**Status:** Built, typechecked + linted clean. Pending production build verification + deploy approval.

## What this adds

A native **Pale** module in the MigraPanel Control Center, alongside the existing
AnnouPale tile. Pale is the phone-first mobile messaging app of the AnnouPale
ecosystem (Android package `com.migrateck.pale`), backed by `pale-api` (NestJS)
on app-core.

- **Tile** in the Ecosystem Control Grid (home Overview + `/console/ecosystem`):
  id `pale`, subtitle "Phone-First Messaging App", logo `pale.png`, honest 0.0%
  activity (no panel-DB metric), default "operational" status, primary action
  → `/console/pale`, secondary → Google Play listing.
- **Native module page** `/console/pale` with a **real live health probe** of
  `pale-api` (unlike AnnouPale, whose web app is on unreachable external infra —
  pale-api is colocated with the console on app-core, so the probe is genuine).

## Files

| File | Change |
| --- | --- |
| `apps/web/src/app/console/lib/pale.ts` | NEW — `getPaleBackendHealth()` (live probe, honest tri-state live/down/unreachable, 1.5s timeout, never fabricates), `formatUptime()`, Play/health constants. |
| `apps/web/src/app/console/pale/page.tsx` | NEW — module overview: backend health, identity & access model, OTP delivery, app/platform, deep links. |
| `apps/web/src/app/console/lib/ecosystem.ts` | `paleTile()` added; appended after `annoupaleTile()` in both return paths. |
| `apps/web/src/app/console/ecosystem/page.tsx` | `pale: "/console/pale"` added to `ROUTE_FOR`. |
| `apps/web/public/brands/products/pale.png` | Pre-existing brand asset (reused). |

## Honesty notes (matches the AnnouPale module bar)

- **No fabricated metrics.** Tile activity is an honest 0.0% (the panel cannot
  measure a separate mobile app's usage). The only live number shown is the
  real `pale-api` health probe + its reported uptime.
- **Probe degrades honestly.** If `pale-api` is unreachable from the console
  host, the module says "Unreachable" rather than faking "operational" or a
  false "down".
- **Facts shown are verified**, reflecting work shipped 2026-06-12:
  - Phone-first OTP via **Telnyx Verify** (SMS live, voice fallback, global incl.
    Haiti +509, 6-digit branded "Pale-AnnouPale" code).
  - **One account per number** (E.164 canonicalization + `User.phoneNumber`
    unique) and **one active device per number** (login revokes prior sessions).
  - **Android zero-tap autofill** marked **Pending** — accurate: the Telnyx hash
    template is blocked on a Telnyx review-engine outage; one-tap autofill is live.
- Deep links open the Google Play listing and the **shared AnnouPale** trust
  surface (Pale moderation/compliance runs through AnnouPale admin). No tokens in
  URLs, no embedded admin, no granted permissions.

## Optional env

- `PALE_API_HEALTH_URL` — overrides the default `http://127.0.0.1:4005/api/health`
  for non-colocated console deployments.

## Verification

- `tsc --noEmit`: exit 0, 0 errors.
- `eslint`: 0 errors, 0 warnings on the new/changed files.
- Production `next build`: (pending at time of writing).
- Deploy: console deploys from the monorepo release snapshot (app-core, atomic
  symlink) — **awaiting deploy approval**.
