# AnnouPale Auth Staging Validation Checklist

This runbook clears the next auth blocker:

- provider-backed staging delivery
- stable staging smoke accounts
- repeatable Block 1 validation without console or dev-only shortcuts

Use this after the local Block 1 flow has passed.

## Goal

Prove that staging auth is not only implemented, but operationally trustworthy.

A staging validation pass is complete only when all of the following are true:

- staging signup sends real email or SMS through a provider-backed path
- staging verification succeeds without console-only shortcuts
- staging login works with stable credentials
- `/v1/me` returns the canonical user and session shape
- `/v1/refresh` rotates refresh and session cookies correctly
- logout revokes the refresh family correctly
- `auth_events` rows persist for the staging flow
- another engineer can repeat the same flow using this document

## Current Repo Reality

Relevant files:

- `apps/auth-api/src/config/env.ts`
- `apps/auth-api/src/lib/email.ts`
- `apps/auth-api/src/lib/notifications.ts`
- `apps/auth-api/src/routes/auth.ts`
- `apps/auth-api/src/modules/audit/index.ts`

Current state:

- email delivery is SMTP-backed
- SMS delivery still falls back to console unless a real provider path is implemented
- local Block 1 validation is already passing
- staging validation is the next blocker

Implication:

- staging email can be made real with configuration
- staging SMS requires either:
  - `AUTH_SMS_PROVIDER=twilio` with real provider credentials, or
  - `AUTH_SMS_PROVIDER=test-lane` with a provider-backed or internal HTTPS capture endpoint

## SMS Environment Contract

### Twilio path

Set:

- `AUTH_SMS_PROVIDER=twilio`
- `AUTH_SMS_TWILIO_ACCOUNT_SID`
- `AUTH_SMS_TWILIO_AUTH_TOKEN`
- one of:
  - `AUTH_SMS_TWILIO_FROM_NUMBER`
  - `AUTH_SMS_TWILIO_MESSAGING_SERVICE_SID`
- optional:
  - `AUTH_SMS_TWILIO_STATUS_CALLBACK_URL`

### Test-lane path

Set:

- `AUTH_SMS_PROVIDER=test-lane`
- `AUTH_SMS_TEST_LANE_URL`
- `AUTH_SMS_TEST_LANE_API_KEY`
- `AUTH_SMS_TEST_LANE_ALLOWED_NUMBERS`
- optional:
  - `AUTH_SMS_TEST_LANE_LABEL`

Rules:

- `AUTH_SMS_PROVIDER=console` is development-only
- test-lane numbers must be explicitly allowlisted
- missing SMS credentials must fail loudly
- app logs should only show masked destinations, never full staging numbers in routine delivery logs

## Provider Setup Checklist

### 1. Email provider

Choose one staging email path and standardize it:

- Postmark
- SES
- Resend
- SendGrid
- existing SMTP relay if it is isolated and monitored

Must be true:

- staging has valid `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`
- staging has `AUTH_EMAIL_FROM` or `SMTP_FROM`
- the sender domain is verified
- delivery logs are accessible to the team running smoke
- provider quotas and suppression rules are understood

Pass criteria:

- a staging signup email is accepted by the provider
- the verification message reaches the intended mailbox
- timestamps and message IDs can be recovered from provider logs

Fail criteria:

- mail only appears in local console logs
- provider rejects sender or recipient
- delivery succeeds but the team has no way to inspect provider-side status

### 2. SMS provider

Choose one staging SMS path:

- Twilio Verify or Messaging
- Vonage
- MessageBird
- other provider-backed test lane with delivery logs

Must be true:

- staging has real provider credentials in secret storage
- the auth service no longer depends on `AUTH_SMS_PROVIDER=console` for staging
- delivery logs are accessible
- test numbers are approved and documented
- retry and rate-limit behavior is understood

Pass criteria:

- a staging phone signup sends a real SMS or a provider-backed test message
- the verification code can be retrieved from the provider path, not the server console
- delivery metadata can be inspected after the run

Fail criteria:

- code retrieval still depends on console output
- SMS delivery is manual or undocumented
- the provider path is only known by one person

## Smoke Account Policy

Create three stable staging accounts.

### 1. Non-admin smoke account

Purpose:

- primary end-user validation

Requirements:

- not an admin
- not a moderator
- uses long-lived mailbox and phone under team control
- enrolled in the standard email-or-phone plus password flow

### 2. Moderator smoke account

Purpose:

- validate privileged account login and future step-up/MFA flows

Requirements:

- moderator role only
- not global admin unless explicitly needed
- separate mailbox and phone from the non-admin account

### 3. Creator or public-profile smoke account

Purpose:

- validate higher-visibility account behavior later without mixing with moderator privileges

Requirements:

- public-profile or creator-type identity if the product model supports it
- separate credentials and contact methods

### Account rules

Must be true:

- credentials live in team-approved secret storage, not in docs or chat
- password rotation owner is assigned
- mailbox and phone ownership are assigned
- there is a recovery path if the verification contact changes
- accounts are marked clearly as staging smoke identities

Fail criteria:

- credentials only exist in one person’s local notes
- recovery contact ownership is unclear
- the only available smoke identity is an admin account

## Required Staging Inputs

Before running smoke, confirm:

- staging auth base URL
- staging auth-web base URL
- `client_id` used by auth-web
- one email inbox reachable by the team
- one phone number reachable by the team
- provider dashboard access for email
- provider dashboard access for SMS
- database or admin access sufficient to inspect `auth_events`

## Staging Auth Preflight Gate

Do not start the staging auth pass until the auth surface itself is reachable.

Must be true:

- the staging auth base URL resolves publicly or is reachable from the validation environment
- the staging auth base URL serves the auth API health endpoint
- the staging auth-web base URL serves the expected login and signup routes
- the team is not mistakenly using the main staging marketing site as the auth surface

Fail fast if any of the following are true:

- the staging auth hostname does not resolve
- the staging auth API health endpoint is missing
- `/login`, `/signup`, `/forgot-password`, or `/reset-password` return `404` on the supposed staging auth-web host
- only the production auth host is reachable

Current execution note:

- `https://auth.migrateck.com/health` is live
- `https://staging.migrateck.com` is the main staging site, not the auth surface
- a separate public staging auth host must exist before the first provider-backed staging auth pass can be completed cleanly

## Exact Smoke Flow

Run both an email-backed path and a phone-backed path if possible.

If only one provider path is ready first, complete that path fully and explicitly mark the other as blocked.

### Flow A
Phone signup to session validation

1. Start signup with phone plus password.
2. Confirm the SMS is delivered through the staging provider path.
3. Verify signup with the received code.
4. Confirm authenticated cookies are set.
5. Call `GET /v1/me`.
6. Call `POST /v1/refresh`.
7. Confirm refresh and session cookies both rotate.
8. Retry refresh with the old refresh token and confirm it fails.
9. Call `POST /v1/logout`.
10. Retry refresh with the latest refresh token and confirm it fails.
11. Confirm `auth_events` contains:
    `SIGNUP`, `SIGNUP_VERIFIED`, `REFRESH_SUCCESS`, `REFRESH_FAILURE`, `LOGOUT`

Pass criteria:

- every step above succeeds with provider-backed delivery
- old refresh token fails after rotation
- refresh fails after logout
- `auth_events` rows exist in staging for the exact user

### Flow B
Email signup to session validation

1. Start signup with email plus password.
2. Confirm the email is delivered through the staging provider path.
3. Verify signup through the code or link path that staging exposes.
4. Confirm authenticated cookies are set.
5. Call `GET /v1/me`.
6. Call `POST /v1/refresh`.
7. Confirm refresh and session cookies rotate.
8. Logout.
9. Confirm refresh after logout fails.
10. Confirm `auth_events` rows exist for the flow.

Pass criteria:

- the message is delivered by the provider, not a local console path
- the same canonical session behavior matches the local Block 1 result

### Flow C
Stable credential login

Use the stable non-admin smoke account.

1. Login with the existing verified identifier and password.
2. Call `GET /v1/me`.
3. Call `POST /v1/refresh`.
4. Confirm rotated cookies differ from the previous set.
5. Logout.
6. Confirm refresh fails after logout.
7. Confirm `auth_events` contains:
   `LOGIN_SUCCESS`, `REFRESH_SUCCESS`, `REFRESH_FAILURE`, `LOGOUT`

Pass criteria:

- stable credentials work without new account setup
- repeated runs do not depend on console logs or seeded local-only shortcuts

## Canonical Pass/Fail Checks

### `/v1/me`

Pass when:

- response is `200`
- `authenticated` is `true`
- `user.id` is present
- `user.email`, `user.phone_e164`, `email_verified`, and `phone_verified` are consistent with the account
- `session.id`, `created_at`, and `expires_at` are present when authenticated by session cookie

Fail when:

- response shape differs from OpenAPI or the shared contracts
- session is missing unexpectedly
- identifier verification flags are wrong

### `/v1/refresh`

Pass when:

- response is `200`
- new refresh cookie differs from the previous refresh cookie
- new session cookie differs from the previous session cookie
- old refresh token returns unauthorized on retry

Fail when:

- refresh succeeds without rotation
- old refresh token continues to work
- revoked session still refreshes

### Logout

Pass when:

- response is `200`
- cookies are cleared
- refresh after logout returns unauthorized

Fail when:

- refresh still succeeds after logout
- only the current cookie clears but the family remains usable

## Evidence To Capture

For each staging run, capture:

- date and environment
- account used
- provider delivery proof for email and SMS
- HTTP status for signup verify, login, `/v1/me`, `/v1/refresh`, logout
- whether refresh cookie rotated
- whether session cookie rotated
- whether old refresh token failed
- whether post-logout refresh failed
- exact `auth_events` rows observed
- any mismatch between OpenAPI and live responses

Store evidence in the team’s normal release or readiness log, not in ephemeral chat only.

## Auth Events Query Check

At minimum, confirm rows exist for the staging smoke user with:

- `event_type`
- `success`
- `created_at`
- expected identifier where applicable

Required event coverage for Block 1:

- `SIGNUP`
- `SIGNUP_VERIFIED`
- `LOGIN_SUCCESS`
- `REFRESH_SUCCESS`
- `REFRESH_FAILURE`
- `LOGOUT`

If password reset is included in the same pass, also confirm:

- `PASSWORD_RESET_REQUEST`
- `PASSWORD_RESET_COMPLETE`

## Ownership

Assign these explicitly before calling the blocker cleared:

- provider setup owner
- staging secret owner
- smoke account owner
- mailbox owner
- phone/test-lane owner
- runbook execution owner
- backup executor who did not build the feature

## Exit Criteria

The operational blocker is cleared only when:

- staging email delivery is real and verified
- staging SMS delivery is real and verified, or explicitly marked as the remaining blocker
- a stable non-admin smoke account exists
- a stable moderator smoke account exists
- the full Block 1 flow is repeatable in staging
- `auth_events` persistence is confirmed in staging
- a second person can execute this runbook successfully

## Recommended Next Actions

1. Configure staging email first, because SMTP wiring already exists.
2. Implement or wire a real staging SMS path in `apps/auth-api/src/lib/notifications.ts`.
3. Create and store stable smoke credentials in the team secret manager.
4. Run this checklist once by the feature owner.
5. Run it again by a second engineer.
6. Only then move on to identifiers, TOTP polish, or broader auth hardening.
