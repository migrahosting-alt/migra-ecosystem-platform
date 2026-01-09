# Runbook: NGINX Domain Sync (srv1-web)

Scope: Align migrahosting.com ↔ mPanel domains safely
Risk: MED (requires NGINX reload)

## Goal

Avoid redirect semantics that can break API POSTs and OAuth callbacks, while keeping expected user-facing URLs working.

## Current state (verified)

- `migrapanel.com` blanket `return 301 https://mpanel.migrahosting.com$request_uri;`
- `mpanel.migrahosting.com` serves frontend and proxies `/api/` to mpanel-core

## Recommended change options

### Option B1 (minimal): change 301 → 308 on migrapanel.com

Pros: preserves method/body on redirects.
Cons: still a redirect (some OAuth providers and clients prefer no redirect).

### Option B2 (better): proxy `/api/` on migrapanel.com; redirect only `/`

Pros: API clients don’t hit redirects; easier compatibility.
Cons: slightly more config.

## Exact commands (inspect-only / validation)

1) Backup current vhost:

- `ssh srv1-web "sudo cp -a /etc/nginx/sites-available/migrapanel.com.conf /etc/nginx/sites-available/migrapanel.com.conf.$(date +%F_%H%M%S).bak"`

2) Validate config syntax:

- `ssh srv1-web "sudo nginx -t"`

3) Reload (ONLY with approval):

- `ssh srv1-web "sudo systemctl reload nginx"`

## Rollback

- Restore the `.bak` file and repeat `nginx -t` + reload.
