# AnnouPale Auth Implementation Checklist

This checklist is dependency-ordered.

Use it to sequence execution, not to reprioritize architecture.

Primary execution rule:

1. Finish the current dependency block completely.
2. Validate it.
3. Only then unlock the next block.

## Block 1
Session truth baseline

### 1.1
Define canonical authenticated response shape

Must complete:

- decide `/v1/me` response shape
- decide `/v1/refresh` response shape
- keep user summary consistent across signup verify, login, refresh, and me

Files:

- `apps/auth-api/src/routes/auth.ts`
- `packages/auth-core/src/validators/auth.ts`
- `packages/api-contracts/src/migraauth/auth.ts`
- `apps/auth-api/openapi.yaml`

### 1.2
Finish cookie-backed refresh model

Must complete:

- choose refresh cookie name
- choose first-party refresh client id
- issue refresh cookie on successful login
- issue refresh cookie on successful signup verify
- clear refresh cookie on logout

Files:

- `apps/auth-api/src/routes/auth.ts`
- `apps/auth-api/src/config/env.ts`
- `apps/auth-api/src/modules/tokens/index.ts`

### 1.3
Tie refresh tokens to current auth session state

Must complete:

- bind refresh record to current auth session
- block refresh when session is revoked or expired
- rotate session cookie secret on refresh
- extend session expiry on refresh

Files:

- `apps/auth-api/src/modules/sessions/index.ts`
- `apps/auth-api/src/modules/tokens/index.ts`
- `apps/auth-api/src/routes/auth.ts`

### 1.4
Finish `/v1/refresh`

Must complete:

- rotate refresh token on every use
- revoke token family on reuse detection
- return canonical user plus session summary
- keep cookie/session behavior consistent after rotation

Files:

- `apps/auth-api/src/routes/auth.ts`
- `apps/auth-api/src/modules/tokens/index.ts`
- `apps/auth-api/src/modules/sessions/index.ts`

### 1.5
Finish `/v1/me`

Must complete:

- require authenticated user
- return canonical user shape
- include session summary when a session cookie is present
- include primary email, primary phone, and verification state

Files:

- `apps/auth-api/src/routes/auth.ts`
- `apps/auth-api/src/middleware/session.ts`
- `apps/auth-api/src/modules/users/index.ts`

### 1.6
Validate Block 1

Must complete:

- auth-api typecheck
- auth-web typecheck
- manual login -> me -> refresh -> me -> logout -> refresh failure flow
- verify old session cookie fails after refresh rotation

## Block 2
Persistent auth events

### 2.1
Add durable event storage

Must complete:

- add `auth_events` schema
- add indexes for user and created time
- define safe metadata contract

Files:

- `apps/auth-api/prisma/schema.prisma`
- `apps/auth-api/prisma/migrations/*`

### 2.2
Write events for existing auth paths

Must complete:

- signup started
- signup verified
- login success
- login failure
- refresh success
- refresh failure
- logout
- reset requested
- reset completed
- session revoke
- session revoke others

Files:

- `apps/auth-api/src/routes/auth.ts`
- `apps/auth-api/src/routes/sessions.ts`
- `apps/auth-api/src/modules/audit/index.ts` or replacement auth-events module

### 2.3
Validate Block 2

Must complete:

- integration assertions for event writes on success and failure
- confirm no raw password, raw token, or raw code is persisted

## Block 3
Identifier lifecycle

### 3.1
Finish identifier service surface

Must complete:

- add identifier
- verify identifier
- set primary identifier
- remove secondary identifier if policy allows

Files:

- `apps/auth-api/src/routes/identifiers.ts`
- `apps/auth-api/src/modules/users/index.ts`
- `apps/auth-api/src/lib/identifier.ts`

### 3.2
Build auth-web second-channel flows

Must complete:

- add email screen
- add phone screen
- verify code flow
- resend cooldown messaging

Files:

- `apps/auth-web/src/app/add-email/page.tsx`
- `apps/auth-web/src/app/add-phone/page.tsx`

### 3.3
Validate Block 3

Must complete:

- logged-in add-email path
- logged-in add-phone path
- primary switching behavior
- second-channel prompt after onboarding or account entry

## Block 4
Risk and abuse controls

### 4.1
Centralize auth rate limits

Must complete:

- login
- signup start
- signup verify
- reset request
- reset verify
- resend code

Files:

- `apps/auth-api/src/server.ts`
- `apps/auth-api/src/middleware/*`
- `apps/auth-api/src/routes/auth.ts`

### 4.2
Add suspicious-login step-up scaffolding

Must complete:

- define trigger signals
- create step-up challenge path
- keep low-risk login on identifier plus password

Files:

- `apps/auth-api/src/routes/auth.ts`
- `apps/auth-api/src/modules/users/index.ts`
- `apps/auth-api/src/modules/sessions/index.ts`

### 4.3
Validate Block 4

Must complete:

- brute-force throttle checks
- resend abuse checks
- suspicious login challenge path

## Block 5
Operational validation path

This block should move in parallel only after Block 1 response and cookie contracts are stable.

### 5.1
Provider-backed staging delivery

Must complete:

- real email provider configured
- real SMS provider or provider-backed test lane configured
- staging-safe delivery verification path documented

Files:

- `apps/auth-api/src/lib/email.ts`
- `apps/auth-api/src/lib/notifications.ts`
- `apps/auth-api/src/config/env.ts`

### 5.2
Stable smoke identities

Must complete:

- non-admin smoke account
- moderator smoke account
- creator or public-profile smoke account
- documented ownership and reset path

### 5.3
Repeatable auth smoke

Must complete:

- signup
- verify
- login
- me
- refresh
- logout
- reset
- revoke others

Files:

- `docs/production-readiness.md`
- `docs/launch-readiness-checklist.md`
- dedicated auth smoke runbook if needed

## Block 6
TOTP hardening

### 6.1
Finish TOTP UX and recovery codes

Must complete:

- setup
- verify
- disable
- recovery codes

Files:

- `apps/auth-api/src/routes/mfa.ts`
- `apps/auth-api/src/modules/mfa/index.ts`
- `apps/auth-web/src/app/mfa/page.tsx`

### 6.2
Validate Block 6

Must complete:

- enrollment happy path
- wrong code
- disable with password confirmation
- recovery code one-time use

## Immediate next slice

Do now:

1. Block 1.1
2. Block 1.2
3. Block 1.3
4. Block 1.4
5. Block 1.5
6. Block 1.6

Only then move to:

7. Block 2.1
8. Block 2.2
9. Block 2.3
