# AnnouPale Auth Staging Host Unblock

Auth rollout is currently blocked by staging environment availability, not auth implementation.

## Current Observations

Validated on April 24, 2026:

- `https://auth.migrateck.com/health` returns `200`
- `https://staging.migrateck.com/login` returns `404`
- `https://staging.migrateck.com/signup` returns `404`
- `https://staging.migrateck.com/forgot-password` returns `404`
- `https://staging.migrateck.com/reset-password` returns `404`
- `https://auth.staging.migrateck.com` does not resolve
- `https://staging-auth.migrateck.com` does not resolve

Conclusion:

- the auth API exists on production
- a public staging auth web surface does not currently exist
- the first provider-backed staging auth validation pass cannot be completed honestly until the staging auth host is reachable

## Request

Provision or expose a dedicated staging auth web surface and matching staging auth API base URL.

## Required Endpoints

### Staging auth web

Must serve:

- `https://<staging-auth-web>/login`
- `https://<staging-auth-web>/signup`
- `https://<staging-auth-web>/forgot-password`
- `https://<staging-auth-web>/reset-password`

### Staging auth API

Must serve:

- `https://<staging-auth-api>/health`

## Required Environment Alignment

The staging auth pair must use matching staging configuration for:

- `AUTH_PUBLIC_URL`
- `AUTH_WEB_URL`
- cookie domain and `Secure` settings
- CORS origins between staging auth web and staging auth API
- provider-backed email delivery
- provider-backed SMS delivery or approved test-lane delivery

## Acceptance Criteria

- public DNS resolves for the staging auth web host
- public DNS resolves for the staging auth API host
- TLS is valid for both hosts
- `/login`, `/signup`, `/forgot-password`, and `/reset-password` return `200` on the staging auth web host
- `/health` returns `200` on the staging auth API host
- auth web and auth API point at the same staging environment
- cookies are configured correctly for the staging auth pair
- CORS is configured correctly for the staging auth pair

## Why This Is Blocking

The next validation step is a real provider-backed staging auth pass:

1. signup
2. verify
3. login
4. `GET /v1/me`
5. `POST /v1/refresh`
6. logout
7. refresh-after-logout failure
8. `auth_events` verification

That pass is not executable until the staging auth web host exists and is reachable.

## Requested Outcome

Reply back with:

- the staging auth web URL
- the staging auth API URL
- confirmation that DNS and TLS are active
- confirmation that the four auth web routes return `200`
- confirmation that cookie and CORS settings match the staging pair
