# AnnouPale Auth Rollout Task Board

This board turns the approved auth architecture into implementation tickets for the current repo shape.

Active implementation boundary:

- `apps/auth-api` for central Fastify auth service
- `apps/auth-web` for auth UI
- `packages/auth-core` for shared validators/contracts

Guiding constraints:

- Keep the current Fastify structure.
- Do not rebuild this as NestJS in the middle of rollout.
- Prioritize stable operational validation early.
- Treat OTP as a verification and challenge mechanism, not the primary identity model.

## Sprint A
Session truth and observability

### AUTH-01
Finish `/v1/refresh` with rotation and family safety

Outcome:
Refresh rotation works on every use, old refresh tokens are invalidated, and token reuse can revoke the token family.

Acceptance criteria:

- `POST /v1/refresh` exists and returns a fresh access token plus rotated refresh token.
- Refresh tokens are stored hashed only.
- Reuse of a revoked or rotated token is detected and handled as a security event.
- Current session and refresh state remain consistent after rotation.
- Revoked sessions cannot continue to refresh.

File targets:

- `apps/auth-api/src/routes/auth.ts`
- `apps/auth-api/src/modules/tokens/index.ts`
- `apps/auth-api/src/modules/sessions/index.ts`
- `apps/auth-api/src/lib/jwt.ts`
- `apps/auth-api/prisma/schema.prisma`
- `apps/auth-api/prisma/migrations/*session*`

### AUTH-02
Finish `/v1/me` with canonical authenticated user shape

Outcome:
All clients can fetch one stable authenticated user payload after login and refresh.

Acceptance criteria:

- `GET /v1/me` returns canonical user identity data.
- Response includes primary email, primary phone, verification state, and session summary where appropriate.
- Disabled or revoked sessions return unauthorized.
- Auth-web can rely on this response without product-specific branching.

File targets:

- `apps/auth-api/src/routes/auth.ts`
- `apps/auth-api/src/middleware/session.ts`
- `apps/auth-api/src/modules/users/index.ts`
- `packages/auth-core/src/validators/auth.ts`

### AUTH-03
Add persistent `auth_events`

Outcome:
Auth actions are written to durable storage and become queryable for debugging and security review.

Acceptance criteria:

- `auth_events` table exists with indexes appropriate for user and time queries.
- Events are recorded for signup started, signup verified, login success, login failure, refresh success, refresh failure, reset requested, reset completed, identifier add, identifier verify, session revoke, and suspicious login escalation.
- Event writes do not leak secrets or raw codes.
- Failed auth operations still emit safe event records.

File targets:

- `apps/auth-api/prisma/schema.prisma`
- `apps/auth-api/prisma/migrations/*auth_events*`
- `apps/auth-api/src/modules/audit/index.ts` or new `apps/auth-api/src/modules/auth-events/index.ts`
- `apps/auth-api/src/routes/auth.ts`
- `apps/auth-api/src/routes/sessions.ts`
- `apps/auth-api/src/routes/oauth.ts`

### AUTH-04
Add refresh and session safety integration tests

Outcome:
Refresh rotation becomes regression-proof.

Acceptance criteria:

- Integration coverage exists for successful refresh rotation.
- Integration coverage exists for refresh token reuse detection.
- Integration coverage exists for revoked-session refresh failure.
- Tests run without relying on dev-only OTP assumptions.

File targets:

- `apps/auth-api/test/*` or repo-standard auth integration test location
- `test/helpers/auth.ts`
- `packages/auth-core/src/tokens/refresh.ts`

## Sprint B
Identifiers and second recovery channel

### AUTH-05
Implement identifier management endpoints

Outcome:
A logged-in user can add and verify the missing recovery channel and manage primaries safely.

Acceptance criteria:

- `POST /v1/identifiers/add` exists.
- `POST /v1/identifiers/verify` exists.
- `POST /v1/identifiers/set-primary` exists.
- Optional remove-secondary endpoint follows policy and does not allow removing the only verified recovery path.
- Password re-entry or equivalent step-up is required for sensitive identifier changes.

File targets:

- `apps/auth-api/src/routes/identifiers.ts`
- `apps/auth-api/src/modules/users/index.ts`
- `apps/auth-api/src/lib/identifier.ts`
- `apps/auth-api/src/lib/notifications.ts`
- `packages/auth-core/src/validators/auth.ts`

### AUTH-06
Build add-email and add-phone auth-web flows

Outcome:
Users can attach the second recovery channel after onboarding or from account settings.

Acceptance criteria:

- Auth-web includes add-email flow.
- Auth-web includes add-phone flow.
- Each flow handles verify code, resend cooldown, expired code, and success redirect.
- Copy clearly explains recovery value of adding the second channel.

File targets:

- `apps/auth-web/src/app/add-email/page.tsx`
- `apps/auth-web/src/app/add-phone/page.tsx`
- `apps/auth-web/src/lib/api.ts`
- `apps/auth-web/src/lib/branding.ts`

### AUTH-07
Backfill legacy identifiers into `user_identifiers`

Outcome:
Legacy users are normalized into the unified identity model without account duplication.

Acceptance criteria:

- Backfill script maps existing `users.email` and `users.phone` style data into `user_identifiers`.
- Existing verified state is preserved.
- Exactly one primary email and one primary phone can exist per user.
- Duplicate identifier conflicts are surfaced safely before production migration.

File targets:

- `apps/auth-api/prisma/migrations/*backfill*`
- `scripts/backfill-auth-link-fields.ts` or new dedicated backfill script
- `apps/auth-api/src/seed.ts` if seeded auth users need updating

## Sprint C
Risk controls and operational validation

### AUTH-08
Add auth rate limits and challenge throttles

Outcome:
Core auth flows resist basic brute force and resend abuse.

Acceptance criteria:

- Limits exist for signup start, signup verify, login, request reset, reset verify, resend code, and step-up verify.
- Limits key on IP plus identifier where practical.
- Challenge attempts are capped and expired correctly.
- Rate-limit responses are consistent and safe.

File targets:

- `apps/auth-api/src/server.ts`
- `apps/auth-api/src/middleware/*rate*`
- `apps/auth-api/src/routes/auth.ts`
- `apps/auth-api/src/routes/identifiers.ts`
- `apps/auth-api/src/config/env.ts`

### AUTH-09
Add suspicious-login detection and step-up scaffolding

Outcome:
Login can escalate when risk signals look abnormal without turning OTP into the default path.

Acceptance criteria:

- New device or burst-failure signals can trigger a step-up requirement.
- Step-up challenges use verified email or verified phone.
- Event records are written for escalations.
- Low-risk logins remain identifier-plus-password only.

File targets:

- `apps/auth-api/src/routes/auth.ts`
- `apps/auth-api/src/modules/users/index.ts`
- `apps/auth-api/src/modules/sessions/index.ts`
- `apps/auth-api/src/modules/audit/index.ts` or `auth-events`

### AUTH-10
Stand up provider-backed staging auth validation

Outcome:
Staging can validate auth with real provider behavior instead of local-only shortcuts.

Acceptance criteria:

- Staging email provider is configured and working.
- Staging SMS provider or provider-backed test lane is configured and working.
- One stable non-admin smoke account exists.
- One moderator smoke account exists.
- Code retrieval path for staging smoke is documented.
- Repeatable smoke checklist exists for signup, verify, login, refresh, logout, reset, and session revoke.

File targets:

- `apps/auth-api/src/lib/email.ts`
- `apps/auth-api/src/lib/notifications.ts`
- `apps/auth-api/src/config/env.ts`
- `docs/production-readiness.md`
- this task board or a dedicated smoke runbook

## Sprint D
2FA and user trust tooling

### AUTH-11
Polish TOTP setup, verify, disable, and recovery codes

Outcome:
Optional TOTP becomes production-usable for moderators, admins, and high-trust users.

Acceptance criteria:

- TOTP setup returns enrollment metadata and recovery codes.
- Disable flow requires password plus current second factor where policy allows.
- Recovery codes are issued, stored hashed, and one-time usable.
- Auth-web setup flow is understandable and resilient.

File targets:

- `apps/auth-api/src/routes/mfa.ts`
- `apps/auth-api/src/modules/mfa/index.ts`
- `apps/auth-web/src/app/mfa/page.tsx`
- `packages/auth-core/src/validators/mfa.ts`

### AUTH-12
Enrich sessions UI with better device trust details

Outcome:
Users can understand and respond to account compromise faster.

Acceptance criteria:

- Sessions page shows current device clearly.
- Sessions page supports revoke-one and revoke-others.
- Device label, approximate location, and last-used timestamps are visible when available.
- Copy explains what revoking a session does.

File targets:

- `apps/auth-web/src/app/sessions/page.tsx`
- `apps/auth-api/src/routes/sessions.ts`
- `apps/auth-api/src/modules/sessions/index.ts`

### AUTH-13
Admin auth tooling for support and security review

Outcome:
Internal teams can investigate auth problems without direct database access.

Acceptance criteria:

- Admin view exposes auth event timeline by user.
- Admin can inspect identifier state and verification state.
- Admin can revoke sessions.
- Admin tools avoid exposing raw codes, raw tokens, or secrets.

File targets:

- `apps/auth-api/src/routes/admin.ts`
- `apps/auth-web/src/app/admin/users/[userId]/page.tsx`
- `apps/auth-web/src/app/admin/audit/page.tsx`

## Cross-cutting test board

### TEST-01
Identifier normalization unit tests

Acceptance criteria:

- Email normalization cases covered.
- US-style phone normalization cases covered.
- Invalid identifier rejection covered.
- Masking helpers covered.

File targets:

- `apps/auth-api/src/lib/identifier.ts`
- test file beside module or repo-standard test location

### TEST-02
Verification challenge unit and integration tests

Acceptance criteria:

- Code generation creates six-digit codes.
- Stored challenge uses hash only.
- Expiry, max attempts, consumed state, and resend cooldown are covered.

File targets:

- `apps/auth-api/src/modules/users/index.ts`
- auth integration test location

### TEST-03
Core auth flow integration suite

Acceptance criteria:

- Signup start and verify.
- Login success and failure.
- Refresh rotation.
- Refresh token reuse detection.
- Reset request and completion.
- Session revoke and revoke-others.

File targets:

- auth integration test location
- `test/helpers/auth.ts`

### TEST-04
Browser auth smoke suite

Acceptance criteria:

- Email signup path.
- Phone signup path.
- Wrong code and expired code flows.
- Forgot password path.
- Second-device login and revoke-others.

File targets:

- browser or E2E suite location used by repo
- `apps/auth-web/src/app/*auth*`

## Operational tickets

### OPS-01
Create stable smoke identities

Acceptance criteria:

- Non-admin smoke account exists.
- Moderator smoke account exists.
- Creator or public-profile smoke account exists.
- Ownership and reset process are documented.

### OPS-02
Document auth smoke runbook

Acceptance criteria:

- Runbook covers staging and production-safe validation.
- Runbook does not rely on local-only OTP shortcuts.
- Runbook defines provider failure handling and expected fallback behavior.

File targets:

- `docs/production-readiness.md`
- `docs/launch-readiness-checklist.md`
- optional dedicated auth smoke runbook in `docs/`

## Immediate priority stack

Do next:

1. `AUTH-01`
2. `AUTH-02`
3. `AUTH-03`
4. `AUTH-04`
5. `AUTH-10`
6. `AUTH-05`
7. `AUTH-06`
8. `AUTH-08`
9. `AUTH-09`
10. `AUTH-11`

## Current repo status note

Already in motion:

- Unified identifier and verification challenge groundwork has been added in `apps/auth-api`.
- Auth-web now follows identifier-plus-verification more closely.
- Session revoke-others UI path exists.

Still blocking confidence:

- provider-backed staging validation
- stable smoke identities
- completed refresh and `/me` surface
- durable auth event storage
