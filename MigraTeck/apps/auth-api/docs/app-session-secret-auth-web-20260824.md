# `APP_SESSION_SECRET` in the auth-web unit — removed, not rotated

## What the slice assumed, and what was actually true

The maintenance request was: move the secret out of inline `Environment=` into a
`0600` EnvironmentFile, rotate it, and prove the rotation invalidates auth-web
sessions.

**auth-web does not read `APP_SESSION_SECRET`.** Verified in four places before
acting: absent from the repo source, from the deployed `.next`, from `src` on the
host, and from its `node_modules`. Only one unit on the host set it.

| Fact | Evidence |
|---|---|
| auth-web never reads it | absent from source, `.next`, host `src`, `node_modules` |
| The unit was world-readable | `644 root:root` |
| Real consumer is `apps/web` (`migrateck.service`) | `src/lib/auth/init.ts` requires it |
| That secret already lives in a `0600` file | `/etc/migrateck/migrateck.env`, `600 root:root` |
| The two values are DIFFERENT | fingerprints `90fac294…` vs `02c58d11…` |

Values were compared by SHA-256 fingerprint; neither was ever printed or copied.

So the inline value was a **stale orphan**: world-readable, bound to nothing, and
not the live one. Rotating it would have minted a fresh secret nothing consumes
and invalidated no sessions — a ritual that looks like security work and removes
no exposure. **The line was deleted instead**, which eliminates the exposure
completely rather than relocating it.

## Proof it was vestigial

After removal and restart, **a pre-existing auth-web session still worked**
(`/v1/me/security` → 200). Had the secret been binding sessions, removing it
would have invalidated that session. It did not. That is the empirical
confirmation, rather than an argument from grep alone.

## Verification after the change

| Check | Result |
|---|---|
| Unit contains `APP_SESSION_SECRET` | no |
| Running process environment contains it | no — env of MainPID lists only `NODE_ENV`, `NEXT_PUBLIC_AUTH_API_URL`, `PORT`, `HOSTNAME`, plus systemd defaults |
| `migrateck-auth-web-stage` | active |
| auth health suite | 8/8 |
| Bare `/login` | MigraAuth branding, password field, Google + GitHub buttons |
| MigraPilot `txn` login | "Sign in to MigraPilot", logo decoded, "Use your MigraTeck account to continue.", "Secured by MigraAuth" |
| Google start | project `612143233496` (MigraPilot's own) |
| GitHub start | `Ov23lirig9COGcixs9vA` |

## Rollback

Unit backed up to `/root/migrateck-auth-web-stage.service.bak-20260824-125704`,
mode `600 root:root` — root-only, not broadly readable. It still contains the old
orphaned value, which is why it is `0600` and why it stays on the box rather than
in this repository.

Rollback is `install` that file back and `systemctl daemon-reload && systemctl
restart migrateck-auth-web-stage`. **Do not treat the old value as worth
restoring**: nothing reads it, and re-adding it would restore the exposure.

## Still open — the rotation that WOULD be real

`apps/web` / `migrateck.service` genuinely uses `APP_SESSION_SECRET`, and its
value is already correctly stored `0600`. If that value should be rotated, it is a
**separate slice on a different app**: rotation there signs out
migrateck.com users, so it needs its own window and its own acceptance. Nothing
was changed for that service here.
