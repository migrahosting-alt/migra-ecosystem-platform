# Canary OAuth client — pinned values, awaiting approval

Nothing here has been applied. Creating an OAuth client is a live MigraAuth change, so the
values are pinned first and the change is Bonex's to make.

## Why a separate client, not a redirect added to `migrapilot_web`

Verified in `MigraTeck/apps/auth-api/src/seed.ts`: the seed's `upsert` **update** block sets
`redirectUris` and `postLogoutRedirectUris` **wholesale**.

```ts
update: {
  redirectUris: client.redirectUris,              // replaces the entire list
  postLogoutRedirectUris: client.postLogoutRedirectUris,
  allowedScopes: client.allowedScopes,
}
```

So any future seed run rewrites the full redirect list of every client it names. Adding the
canary redirect to a shared client couples test infrastructure to production sign-in and puts
it one seed run away from being dropped — or from dropping production's own URIs.

`migrapilot_web` is **not** in the seed at all; it was registered directly against the live
database. **The canary client must likewise be a targeted insert — never `seed.ts`, and never
a seed run.**

## The blocker: the session cookie is `Secure`

`packages/auth-client/src/session.ts` sets `httpOnly: true, secure: true` and **no `domain`**,
so the cookie is host-only and HTTPS-only. All three properties are correct and none should be
relaxed for testing. The canary currently serves plain HTTP on the tailnet, which a `Secure`
cookie will never be sent to. That must be solved before an authenticated canary session can
exist at all.

`CertDomains` is `None` on this tailnet — Tailscale HTTPS is not enabled — so there is no
ready TLS name today.

### Option A (recommended): loopback + SSH tunnel

Browsers treat `http://localhost` as a **secure context**, so `Secure` cookies are sent over it.
No TLS, no certificate, no DNS, and the canary becomes *less* reachable than the tailnet plan:
loopback only.

- bind the canary consumer to `127.0.0.1:3100` (change `-H 100.95.14.29` to `-H 127.0.0.1`)
- reach it with `ssh -L 3100:127.0.0.1:3100 migrapilot-app-core`
- this deployment already registers `http://localhost:3000/auth/callback` style URIs for other
  clients, so a localhost redirect is an established pattern here, not a special case

Trade-off: this is a loopback host, not the tailnet host originally specified. It is strictly
tighter, and it removes the Tailscale-HTTPS prerequisite entirely.

### Option B: Tailscale HTTPS

Enable HTTPS in the Tailscale admin console, `tailscale cert`, then `tailscale serve` to
terminate TLS on `migrapilot-app-core.tail9e1625.ts.net` and proxy to `127.0.0.1:3100`.
Closer to the original "tailnet-only host" wording, but it needs a tailnet admin change first.

## Pinned values (Option A)

| field | value |
|---|---|
| client id | `migrapilot_canary` |
| client name | `MigraPilot Canary (non-production)` |
| client type | `web` |
| consumer host | `127.0.0.1:3100` on VM111, reached via SSH tunnel as `localhost:3100` |
| redirect URI | `http://localhost:3100/api/auth/callback` |
| post-logout redirect URI | `http://localhost:3100/` |
| allowed scopes | `openid profile email offline_access` — identical to the consumer's `DEFAULT_SCOPES` |
| client secret | none — `migrapilot_web` is a public PKCE client (`resolveAuthPort.ts:59` records that the issuer advertises `none`). The canary matches it, or auth behaviour is not production-parity. |
| canary env additions | `MIGRAAUTH_CLIENT_ID`, `MIGRAAUTH_REDIRECT_URI`, `APP_BASE_URL`, `MIGRAAUTH_POST_LOGOUT_REDIRECT_URI`, and its **own** `APP_SESSION_SECRET` |
| production client | **untouched** |

The canary's `APP_SESSION_SECRET` must be newly generated and canary-only. Sharing production's
would make a production session valid on the canary and vice versa, which is exactly the
cross-boundary replay this design refuses.

## Verification to run immediately after creation

1. `migrapilot_web` is logically unchanged — its `redirectUris`, `postLogoutRedirectUris` and
   `allowedScopes` compared before and after, field by field
2. canary login redirects **only** to the canary callback, never to a production URI
3. the canary session cookie is still `httpOnly`, `secure`, and host-only
4. an authenticated canary conversation writes to the **canary** Brain and canary state only
5. that same conversation is **absent** from production (the `404`-on-production check the
   canary already passes unauthenticated)

## What I need from Bonex

- pick Option A or B
- create the client (I will not touch the live auth database)
- generate the canary `APP_SESSION_SECRET` and tell me the variable name to write it into —
  I will not read the value

Then the authenticated destructive matrix can run: index-promotion failure, upload/library read
failure, partial-delete cleanup and the real 207 UI, non-searchable and recovery transitions,
and capability outage/recovery through the composer — including the first end-to-end proof of
the new "produced but not saved" distinction.
