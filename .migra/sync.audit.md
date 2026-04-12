# Sync Audit — migrahosting.com ↔ MigraPanel

Date: 2026-01-06
Mode: inspect-only (no production changes applied)

## Key findings (verified)

### 1) `migrapanel.com` needs to align with the canonical MigraPanel host

On `srv1-web`, `migrapanel.com` and `www.migrapanel.com` should align with the live control host instead of redirecting through legacy `mpanel` aliases.

- Recommended canonical host: `https://control.migrahosting.com`

This includes `/api/*` and `/portal/auth/*` paths.

Why this matters:
- 301/302/303 redirects can change POST → GET in many clients.
- Server-side proxy code can also follow redirects and lose request bodies.
- OAuth redirect URIs should be stable and match the actual served host.

### 2) Marketing backend proxies portal auth to the MigraPanel Panel API

In `migrahosting-marketing-site/server/index.js`, these are proxied upstream:

- `/api/auth/*`
- `/api/client/*`
- `/api/portal/auth/*`

Upstream should target the current control hostname or direct panel API origin.

Risk:
- If the upstream points at a redirecting legacy host, POST requests can break.

### 3) MigraPanel cookie + CORS is mostly aligned

On `migrapanel-core` (`/opt/MigraPanel/apps/panel-api/.env`):

- Cookie config (good for cross-subdomain auth):
  - `SESSION_COOKIE_DOMAIN=.migrahosting.com`
  - `SESSION_COOKIE_SAMESITE=none`
  - `SESSION_COOKIE_SECURE=true`

- CORS allowlist includes:
  - `https://migrahosting.com`
  - `https://migrapanel.com`
  - `https://control.migrahosting.com`

Potential mismatch:
- `panel.migrahosting.com` exists in NGINX but is not in `CORS_ORIGIN`.

## Minimal production fixes (recommended)

### A) Make marketing → MigraPanel proxy non-redirecting (LOW risk)

Set the marketing backend upstream to:

- `https://control.migrahosting.com`

This avoids the `migrapanel.com` 301 entirely for API traffic.

### B) Fix `migrapanel.com` redirect semantics (MED risk, requires NGINX reload)

Pick one:

- Option B1: change `301` → `308` to preserve method/body.
- Option B2: proxy `/api/` (and optionally `/portal/auth/`) and only redirect `/`.

### C) Canonical domain decision (required for OAuth)

Decide which host is canonical for MigraPanel:

- Canonical = `control.migrahosting.com` (recommended)
  - Update OAuth redirect URIs to `https://control.migrahosting.com/portal/auth/<provider>/callback`
  - Consider setting `APP_URL=https://control.migrahosting.com`

OR

- Canonical = `migrapanel.com`
  - Stop redirecting `migrapanel.com` and instead serve the app there.

## Approvals needed

- NGINX edits on `srv1-web` (config edit + `nginx -t` + reload)
- Env edits / restart on the marketing backend service on `srv1-web`
- Env edits / restart on `migrapanel-core` (`sudo systemctl restart migrapanel-panel-api.service`)
