# Runbook: mPanel Env Sync (mpanel-core)

Scope: Origin/cookie/OAuth env alignment
Risk: MED (PM2 restart; no NGINX changes)

## Goal

- Ensure mPanel API accepts the correct origins (CORS)
- Ensure cookies are valid across `.migrahosting.com`
- Ensure OAuth redirect URIs match the actually-served host

## Current state (verified)

- `CLIENT_PORTAL_UI_URL=https://migrahosting.com`
- `SESSION_COOKIE_DOMAIN=.migrahosting.com`, `SESSION_COOKIE_SAMESITE=none`, `SESSION_COOKIE_SECURE=true`
- `CORS_ORIGIN` does NOT include `https://panel.migrahosting.com`
- OAuth client IDs/secrets are empty

## Recommended env adjustments

- Add `https://panel.migrahosting.com` to `CORS_ORIGIN` OR stop using that hostname.
- Consider setting `APP_URL=https://mpanel.migrahosting.com` if the backend generates absolute URLs for callbacks/emails.
- Set OAuth provider credentials and register redirect URIs for the chosen canonical host.

## Exact commands

1) Edit env (no secrets pasted into chat; edit on-server):

- `ssh root@100.97.213.11 "sudo nano /opt/mpanel/.env"`

2) Restart API with updated env:

- `ssh root@100.97.213.11 "cd /opt/mpanel && /usr/local/bin/pm2 restart mpanel-api --update-env && /usr/local/bin/pm2 status"`

3) Validate from server:

- `ssh root@100.97.213.11 "curl -sS http://127.0.0.1:2271/api/portal/auth/providers"`

## Rollback

- Revert the env edits and restart the same PM2 process with `--update-env`.
