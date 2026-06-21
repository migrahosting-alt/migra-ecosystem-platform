# Unified Client Portal Auth Cutover

This folder is the clean source of truth for migrating the live MigraHosting client portal from split legacy auth to the central `auth.migrateck.com` identity system.

## Problem

The ecosystem currently has two active authorities:

1. Central MigraAuth in `MigraTeck`
2. Legacy local client auth in `New Migra-Panel`

That split caused the live client portal at `https://control.migrahosting.com/client` to keep local email/password auth while newer platform surfaces moved to central OAuth.

## Permanent Direction

- `auth.migrateck.com` becomes the only credential authority.
- `control.migrahosting.com/client` becomes a relying party.
- `panel-api` remains the portal bootstrap authority that creates or links:
  - local user
  - tenant
  - membership
  - customer
  - future profile subject state

## Dedicated Portal Client

- Client id: `migrahosting_client_portal`
- Redirect URI: `https://control.migrahosting.com/client/auth/callback`
- Post logout URI: `https://control.migrahosting.com/client/login`

## Phase Order

1. Register the dedicated portal OAuth client in central auth.
2. Add the portal callback bridge in the client portal stack.
3. Link central identity to local portal account records in `panel-api`.
4. Flip `/client/login` to central auth launch.
5. Convert registration to central-auth-first account creation.
6. Disable legacy local credential authority after validation.

## Non-Goals For Cutover

- No Stripe or billing changes
- No MigraPay mutations
- No DNS, nginx, TLS, or mail-DNS provisioning
- No customer impersonation
- No silent login email rewrites across systems

## Implementation Home

Shared portal auth routing, client mapping, and bootstrap contracts live in:

- `packages/portal-auth-bridge`

That package exists to stop host mapping, callback ownership, and bootstrap expectations from being hardcoded across multiple apps.
