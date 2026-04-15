# MigraTeck Authentication & Identity Standard

Single source of truth for every product in the MigraTeck ecosystem.

## Purpose

This document defines the mandatory authentication, identity, and access model for every MigraTeck application.

All applications must follow this standard for:

- login
- signup
- sessions
- protected routes
- user identity
- organization access
- permissions

This standard exists to guarantee:

- one identity system
- centralized security controls
- real cross-product SSO
- zero duplication of auth logic
- scalable multi-product architecture

## Non-Negotiable Rule

MigraAuth is the only system that handles authentication.

No product application may implement its own:

- password login system
- password reset system
- email verification system
- MFA system
- passkey system
- identity database

## Architecture

### Central identity provider: MigraAuth

MigraAuth owns:

- users
- credentials
- global sessions
- MFA
- passkeys
- recovery flows
- email verification
- password reset
- OAuth / OIDC
- connected applications
- organization identity
- identity and security audit trails

In this repo, that responsibility maps to:

- `apps/auth-api`
- `apps/auth-web`

### Product applications

Each product app owns:

- product UI
- product data
- product-specific onboarding
- local relying-party sessions
- product authorization
- product audit events

In this repo, product-facing relying parties should standardize on:

- `packages/auth-client`

### Required relationship model

`User -> MigraAuth -> Product App -> Product Data`

Not:

`User -> Product App -> Product-local Auth -> Product Data`

## Identity model

### Global identity

- One user equals one MigraAuth account.
- The same account must work across all MigraTeck products.

### Multi-organization support

- Users may belong to multiple organizations.
- Every product app must resolve:
  - active organization
  - role
  - derived permissions

## Required integration model

Every product app must act as an OAuth / OIDC relying party.

## Required login flow

1. User opens the product app.
2. The app detects that no local relying-party session exists.
3. The app redirects to MigraAuth `/authorize`.
4. The user authenticates on MigraAuth hosted pages.
5. MigraAuth redirects back to the product callback with an authorization code.
6. The product exchanges the code for tokens.
7. The product bootstraps local app state.
8. The product creates its own local session cookie.
9. The user enters the product dashboard.

## Required signup flow

1. User selects create account inside a product.
2. The product redirects to MigraAuth hosted signup.
3. MigraAuth owns account creation and verification.
4. After authentication, the product callback bootstraps local state.
5. The product creates its own local session.

## Required routes for every Next.js product app

These file paths are relative to the app package root:

- `src/app/login/page.tsx`
- `src/app/signup/page.tsx`
- `src/app/auth/callback/route.ts`
- `src/app/api/me/route.ts`
- `src/app/api/logout/route.ts`

Recommended protected example:

- `src/app/dashboard/page.tsx`

### Route responsibilities

`/login`

- Must redirect to MigraAuth.
- Must not process credentials locally.

`/signup`

- Must redirect to MigraAuth.
- Must not create users locally.

`/auth/callback`

- Must validate state.
- Must exchange the authorization code.
- Must create the local app session.
- Must bootstrap org and permission context.
- Must redirect to the app dashboard.

`/api/me`

- Must return normalized app context:

```json
{
  "user": {},
  "activeOrg": {},
  "permissions": [],
  "productAccount": {}
}
```

`/api/logout`

- Must destroy the local relying-party session.
- May optionally redirect to central logout.

## Local storage rules

Allowed:

- product account rows
- onboarding state
- org-specific customer linkage
- product-specific preferences

Forbidden:

- password hashes
- MFA secrets
- password reset tokens
- email verification tokens

## Session rules

Product sessions must be:

- HTTP-only
- server-managed
- revocable
- org-aware

Each product session should contain:

- `sessionId`
- `authUserId`
- `orgId`
- `permissions`
- product-specific derived display context

Raw upstream OAuth tokens should not be stored in product cookies unless there is a clear, justified server-side need.

## Authorization split

- MigraAuth handles authentication.
- Product apps handle authorization.

Products must derive permissions from organization role plus product rules.

## First-login bootstrap

On first successful authentication, the product app must bootstrap product-local state:

- create a product account record if needed
- attach the active organization
- assign defaults
- derive permissions

In code, the only product-specific auth hook should be the app bootstrap function passed into `@migrateck/auth-client`.

## Security rules

- No local auth systems.
- No credential duplication.
- All sensitive writes validated.
- All privileged actions audited.
- Secure cookie handling is mandatory.
- CSRF protections are required for mutating product routes.

## SSO behavior

The target behavior across the ecosystem is:

- one identity
- one central login
- seamless switching between products
- independent product sessions built from the same MigraAuth identity

## Canonical agent instruction

Use this block in every product-level system prompt or build instruction:

> This application must use MigraAuth as the sole authentication provider.
>
> Do not implement local authentication systems.
>
> Login and signup must redirect to MigraAuth.
>
> On successful authentication:
> - exchange the authorization code
> - create a local session
> - resolve the active organization
> - derive product permissions
>
> Store only product-specific user data locally.
>
> Protect all routes using MigraAuth-derived sessions.
>
> Enforce permissions for all actions.
>
> Audit all sensitive operations.

## Standard package in this repo

All product integrations should use:

- `packages/auth-client`

Each product must provide:

- one auth initializer
- one bootstrap function
- one permission map

Everything else should remain standardized.

## Current rollout target in this repo

Immediate source-of-truth artifacts:

- `docs/MIGRATECK_AUTH_STANDARD.md`
- `packages/auth-client`

Initial relying-party example:

- `apps/web`

Central identity provider:

- `apps/auth-api`
- `apps/auth-web`
