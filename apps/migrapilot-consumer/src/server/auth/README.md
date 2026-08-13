# Auth — the MigraAuth seam

## Why a port instead of the package

`@migrateck/auth-client` is `"private": true` with `peerDependencies: { next: "^16.2.12" }`.
It is workspace-resolved and unpublishable, so it cannot be installed while this
application lives outside the canonical monorepo.

`authPort.ts` therefore mirrors that package's exact types and the subset of its
surface this app consumes. **No OIDC logic is reimplemented here.** The shipped
default (`unconfiguredAuthPort`) refuses every operation — an unconfigured build
serves no principal rather than a fabricated one.

## Wiring the real package

When this app lands at `apps/migrapilot-consumer`, add the workspace dependency
and create the adapter below. Nothing else in the application changes: every
call site already depends on `AuthPort`, not on the package.

```ts
// src/server/auth/migraAuthPort.ts
import 'server-only'
import {
  buildLoginRedirect,
  buildLogoutRedirect,
  clearAppSession,
  getAppSession,
  handleOAuthCallback,
} from '@migrateck/auth-client'
import type { AuthPort } from './authPort'

export const migraAuthPort: AuthPort = {
  getSession: () => getAppSession(),
  buildLoginRedirect,
  buildLogoutRedirect,
  handleCallback: ({ code, state, bootstrap }) => handleOAuthCallback({ code, state, bootstrap }),
  clearSession: () => clearAppSession(),
}
```

Then, at the composition root:

```ts
import { setAuthPort } from '@/server/auth'
import { migraAuthPort } from '@/server/auth/migraAuthPort'
setAuthPort(migraAuthPort)
```

`initAuthClient(config)` must also be called once with `AuthClientConfig`
(`migraAuthBaseUrl`, `clientId`, `clientSecret`, `redirectUri`, `appBaseUrl`,
`scopes`, `sessionCookieName`, `sessionSecret`). Those are server environment
values and must never be exposed as `NEXT_PUBLIC_*`.

## The flow, for reference

`buildLoginRedirect()` → MigraAuth `/authorize` (PKCE **S256**) → callback →
`handleOAuthCallback` verifies `state`, calls `/token`
(`grant_type=authorization_code` + `code_verifier`), calls `/userinfo`, runs the
app's `BootstrapFn`, and writes an `httpOnly` / `sameSite=lax` session cookie.

## PR #147 — treat as pending

`/userinfo` currently returns only standard OIDC claims:
`sub, email, email_verified, phone_number, phone_number_verified, name,
given_name, family_name, picture, locale`.

`org_roles` and `org_membership_id` appear nowhere in `auth-api/src`. **Do not
fabricate them.** Organization context reaches the session through `BootstrapFn`
→ `BootstrapResult.activeOrg`, not through token claims.

`AppSession` already carries `activeOrgId` / `activeOrgName` / `activeOrgRole`,
so when #147 lands the only change is where bootstrap sources them — the session
shape, the tenancy mapping, and every consumer stay as they are.

Anything depending on `org_id` audience enforcement stays behind the production
gate until #147 and the live-client reconciliation are resolved.
