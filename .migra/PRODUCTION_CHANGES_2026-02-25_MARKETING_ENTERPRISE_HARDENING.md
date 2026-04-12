# Marketing Enterprise Hardening — Production Changes Applied (2026-02-25)

## Scope
- Host: `srv1-web` (`100.68.239.94`)
- Domain: `marketing.migrahosting.com`
- Service: `migra-market.service` (`/var/www/marketing.migrahosting.com`, port `4300`)

## Summary
- Applied enterprise hardening to the dedicated marketing vhost and MigraMarket API.
- Kept domain behavior intact: `marketing.migrahosting.com` remains canonical for MigraMarket.
- No destructive rollback operations were used.

## Changes Applied

### 1) NGINX: dedicated marketing vhost hardened

**Files**
- `/etc/nginx/sites-enabled/marketing.migrahosting.com.conf`
- `/etc/nginx/sites-available/marketing.migrahosting.com.conf`

**Hardening updates**
- Enforced HTTPS redirect with `308` on port 80.
- Added and enforced security headers:
  - `Strict-Transport-Security`
  - `X-Frame-Options`
  - `X-Content-Type-Options`
  - `Referrer-Policy`
  - `Permissions-Policy`
- Added hidden-file deny rule (`location ~ /\.(?!well-known)`).
- Tightened proxy forwarding metadata:
  - `X-Forwarded-Host`
  - `X-Request-ID` (API path)
- Added explicit API `Cache-Control: no-store`.
- Kept SPA proxy behavior and static asset caching.

**Validation**
- `nginx -t` passed
- `systemctl reload nginx` completed

### 2) MigraMarket API hardening (port 4300)

**Files**
- `/var/www/marketing.migrahosting.com/server/index.ts`
- `/var/www/marketing.migrahosting.com/server/routes/auth.ts`
- `/var/www/marketing.migrahosting.com/server/middleware/auth.ts`
- `/var/www/marketing.migrahosting.com/.env`

**Security updates**
- Production JWT guardrails:
  - Require `JWT_SECRET` with minimum length in production.
- CORS tightened:
  - Explicit allowlist (`CORS_ORIGIN`) instead of permissive reflection.
  - Disallowed origins no longer return server errors.
- Rate limits:
  - `/api/auth/*` strict policy (`25` requests / `15m`).
  - General `/api/*` policy (`300` requests / `15m`).
  - General limiter skips `/api/auth/*` to avoid policy override.
- Auth/session hardening:
  - Cookie session only; auth responses do not echo JWT in JSON.
  - Cookie options hardened (`HttpOnly`, `Secure`, `SameSite=Lax`, domain support).
  - `Cache-Control: no-store` on auth endpoints.
  - Registration password minimum set to 12 characters.
- App header policy alignment:
  - Disabled overlapping Helmet header modules where edge policy is authoritative.

**Env updates**
- `APP_URL=https://marketing.migrahosting.com`
- `CORS_ORIGIN=https://marketing.migrahosting.com,https://migrahosting.com,https://www.migrahosting.com,https://control.migrahosting.com`
- `AUTH_COOKIE_DOMAIN=.migrahosting.com`

### 3) Build/runtime fixes for production tree

**Context**
- Production deploy tree did not include full frontend build toolchain/tsconfig base.

**Actions**
- Added standalone `tsconfig.server.json` for server-only compile.
- Installed dependencies including dev tooling needed for compile.
- Recompiled `dist/server/*`.
- Restarted `migra-market.service`.

## Runtime Verification (2026-02-25)

- `systemctl is-active nginx` -> `active`
- `systemctl is-active migra-market` -> `active`
- `systemctl is-active migrahosting-backend` -> `active`
- `curl -I http://marketing.migrahosting.com` -> `308` to HTTPS
- `curl -I https://marketing.migrahosting.com/api/health` -> `200`
- `curl -I https://marketing.migrahosting.com/api/auth/me` -> `401` with auth limiter headers (`25`)
- Disallowed origin request -> `401` without permissive CORS allow-origin

## Backup / Rollback

Backup path created before edits:
- `/root/migra-market-enterprise-20260225T064806Z`

Rollback outline:
1. Restore backup files from the path above.
2. `nginx -t && systemctl reload nginx`
3. `systemctl restart migra-market`
