# MigraMail console module (`/console/mail`)

Permissioned MigraMail mailbox access inside the MigraPanel console. Staff see
only the ecosystem mailboxes they're authorized for; all access is enforced in
the MigraMail backend (this module is a design-consistent UI + a server-side
proxy that mints a short-lived signed identity). Secrets never reach the browser.

## How it works

- `lib/mail-identity.ts` resolves the acting staff identity (env admin → `super_admin`,
  otherwise `mail_staff_user` in the `migrapanel` DB) and mints a short-lived
  HMAC panel-identity token.
- `mail/api/mm/[...path]/route.ts` proxies browser requests to the MigraMail
  backend `/api/webmail/panel/*`, injecting the identity token server-side.
- `mail/api/staff/route.ts` manages staff identities (Super-Admin only).
- The MigraMail backend re-enforces every mailbox permission, so the proxy is
  defence-in-depth, not the sole gate.

## Required environment (set in the console runtime env, e.g. `/etc/migrateck/console.env`)

| Variable | Purpose |
| --- | --- |
| `MIGRAMAIL_PANEL_API_BASE` | Base URL of the MigraMail backend reachable from the console host (server-side only). |
| `MIGRAMAIL_PANEL_SECRET` | Shared HMAC secret used to sign panel-identity tokens. **Must equal** the backend's `MIGRAMAIL_PANEL_SECRET`. Server-side only — never exposed to the browser. |

> Do not commit real values. These are provisioned only in the runtime env file.

## Database

Apply once to the **`migrapanel`** database (console DB):

```
psql "$MIGRAPANEL_DB_URL" -f sql/001_mail_staff_user.sql
```

`mail_staff_user` holds staff identity + RBAC role (`super_admin`, `admin`,
`support`, `billing`, `sales`, `readonly`). The env bootstrap admin is always
`super_admin` and needs no row. Mailbox grants live in the MigraMail backend
(`mail` DB), keyed by email + role.
