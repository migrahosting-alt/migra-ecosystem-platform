# Runbook: Portal + Social Login Enablement

Risk: MED (OAuth configuration + API restart)

## Goal

Turn on social login providers and ensure OAuth popup callback works for the marketing portal origin.

## Prereqs

- Choose canonical mPanel host:
  - Prefer: `https://mpanel.migrahosting.com`
  - Avoid relying on `migrapanel.com` redirects for callbacks

## Steps

1) In each OAuth provider console, create an app and set redirect URI:

- Google: `https://<CANONICAL_MPANEL_HOST>/portal/auth/google/callback`
- Microsoft: `https://<CANONICAL_MPANEL_HOST>/portal/auth/microsoft/callback`
- GitHub: `https://<CANONICAL_MPANEL_HOST>/portal/auth/github/callback`
- Apple: `https://<CANONICAL_MPANEL_HOST>/portal/auth/apple/callback`

2) Set provider credentials on mpanel-core in `/opt/mpanel/.env`:

- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`
- `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET`, `MICROSOFT_OAUTH_TENANT`
- `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`
- Apple keys as required by your implementation

3) Restart API:

- `pm2 restart mpanel-api --update-env`

4) Validate:

- `GET /api/portal/auth/providers` returns enabled providers
- Complete OAuth flow in browser and confirm postMessage target origin matches `CLIENT_PORTAL_UI_URL=https://migrahosting.com`

## Rollback

- Clear the OAuth env vars and restart.
