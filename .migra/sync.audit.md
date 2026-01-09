# Sync Audit — migrahosting.com ↔ mPanel

Date: 2026-01-06
Mode: inspect-only (no production changes applied)

## Key findings (verified)

### 1) `migrapanel.com` is a blanket 301 redirect

On `srv1-web`, `migrapanel.com` and `www.migrapanel.com` both do:

- `return 301 https://mpanel.migrahosting.com$request_uri;`

This includes `/api/*` and `/portal/auth/*` paths.

Why this matters:
- 301/302/303 redirects can change POST → GET in many clients.
- Server-side proxy code can also follow redirects and lose request bodies.
- OAuth redirect URIs should be stable and match the actual served host.

### 2) Marketing backend proxies portal auth to mPanel

In `migrahosting-marketing-site/server/index.js`, these are proxied upstream:

- `/api/auth/*`
- `/api/client/*`
- `/api/portal/auth/*`

Upstream is chosen by `MPANEL_API_BASE_URL` (or `MPANEL_API_URL`).

Risk:
- If `MPANEL_API_BASE_URL=https://migrapanel.com`, the upstream 301 redirect can break POST requests.

### 3) mPanel cookie + CORS is mostly aligned

On `mpanel-core` (`/opt/mpanel/.env`):

- Cookie config (good for cross-subdomain auth):
  - `SESSION_COOKIE_DOMAIN=.migrahosting.com`
  - `SESSION_COOKIE_SAMESITE=none`
  - `SESSION_COOKIE_SECURE=true`

- CORS allowlist includes:
  - `https://migrahosting.com`
  - `https://migrapanel.com`
  - `https://mpanel.migrahosting.com`

Potential mismatch:
- `panel.migrahosting.com` exists in NGINX but is not in `CORS_ORIGIN`.

## Minimal production fixes (recommended)

### A) Make marketing → mPanel proxy non-redirecting (LOW risk)

Set on the marketing backend runtime env:

- `MPANEL_API_BASE_URL=https://mpanel.migrahosting.com`

This avoids the `migrapanel.com` 301 entirely for API traffic.

### B) Fix `migrapanel.com` redirect semantics (MED risk, requires NGINX reload)

Pick one:

- Option B1: change `301` → `308` to preserve method/body.
- Option B2: proxy `/api/` (and optionally `/portal/auth/`) and only redirect `/`.

### C) Canonical domain decision (required for OAuth)

Decide which is canonical for mPanel:

- Canonical = `mpanel.migrahosting.com` (recommended with current NGINX)
  - Update OAuth redirect URIs to `https://mpanel.migrahosting.com/portal/auth/<provider>/callback`
  - Consider setting `APP_URL=https://mpanel.migrahosting.com`

OR

- Canonical = `migrapanel.com`
  - Stop redirecting `migrapanel.com` and instead serve the app there.

## Approvals needed

- NGINX edits on `srv1-web` (config edit + `nginx -t` + reload)
- Env edits / restart on the marketing backend service on `srv1-web`
- Env edits / restart on `mpanel-core` (`pm2 restart mpanel-api --update-env`)
