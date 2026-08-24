# Platform authorization cutover — 2026-08-24

`/v1/admin/*` moved from the `AUTH_ADMIN_USER_IDS` env allowlist to durable
role grants in the database. Deployed and proven live against production.

## Sequence executed

| # | Step | Result |
|---|---|---|
| 1 | Apply migration `014` | applied; `platform_role_grants` present |
| 2–3 | Sync schema, `prisma generate` **on host** | Prisma Client v7.8.0 |
| 4 | Prisma gate | **416 fields** (was 402) |
| 4b | Admin-guard gate on host artifact | 18/18 routes name a permission |
| 5 | Restart by exact unit | active |
| 6 | Auth health | 8/8 |
| 7 | First OWNER grant to the production identity | `granted_by = NULL` (documented bootstrap shape) |
| 9–10 | `AUTH_ADMIN_USER_IDS` removed, restart | removed from file **and** running process |
| 11 | Database grant alone authorizes | ✓ `via_bootstrap: false` |
| 12 | Ordinary account vs **12** admin routes | all blocked, zero leaks |
| 13 | Permission boundaries | see below |
| 14 | Revocation effective on the **next request** | ✓ no restart |
| 15 | Revoked grants retained with `revoked_at` | 5 rows total, 1 live |
| 16 | Last OWNER cannot be revoked | ✓ `409 last_owner` |
| 17 | Every admin route names a permission | structural gate, 18/18 |
| 18 | Bootstrap env absent from process | ✓ |
| 19 | Tests + gates + health | 109/109, gates pass, 8/8 |

## Permission boundaries, measured live

| | users.read | audit.read | clients.read | users.suspend | users.mfa_reset | roles.manage |
|---|---|---|---|---|---|---|
| SUPPORT | 200 | 200 | **404** | **404** | **404** | **404** |
| OPERATOR | 200 | 200 | 200 | route ran | route ran | **404** |
| OWNER | 200 | 200 | 200 | route ran | route ran | 200 |
| no roles | **404** | **404** | **404** | **404** | **404** | **404** |

A guard-404 says `"Not found."`; a route that actually ran answers
`"No such user."` for a ghost id. That distinction is what makes "the route
never executed" provable rather than inferred from a status code alone.

## Ordering chosen so a failure could not lock anyone out

The last-OWNER proof required the production identity's grant to be revoked
briefly. It was run **before** `AUTH_ADMIN_USER_IDS` was removed, so the
bootstrap net still covered that account throughout; the grant was restored
through the API immediately afterwards, and only then was the env var deleted.

## Deviation from the requested sequence

Step 7 asked for bootstrap authority to be used *through the API*. That needs an
authenticated session for the bootstrap-listed account — the production identity
— and the agent cannot authenticate as its owner. The first grant was therefore
written directly with `granted_by = NULL`, which is the shape the schema
documents for a bootstrap grant. Everything downstream (grant, revoke,
last-owner, boundaries, cutover) **was** exercised through the live API, using
the disposable account as the subject.

Not exercised live: bootstrap authority authorizing an API call. It is covered by
unit tests (fallback ordering, deny-by-default, audit-on-use) and is a one-time
path that never fires again once a real grant exists.

## Audit evidence

`PLATFORM_ROLE_GRANTED` 1 · `PLATFORM_ROLE_REVOKED` 2 ·
`PLATFORM_ROLE_REVOKE_REFUSED` 1 (`reason: last_owner`) ·
`ADMIN_ACCESS_DENIED` 21, each recording the **required permission** and the
roles actually held. No secret or credential appears in any row.

## Final state

One live grant: the production identity holds `OWNER`. All acceptance fixtures
revoked, history retained. `AUTH_ADMIN_USER_IDS` no longer exists in the
EnvironmentFile or the process. Env backup: `/etc/migrateck/auth-api-stage.env.bak-preadmincutover-20260824-182136` (0600 root).

## Follow-up noticed, not acted on

`requireAuthenticatedUser` refuses only `status === "DISABLED"`. A **LOCKED**
account therefore keeps working through an existing session — locking prevents
new sign-ins but does not end current ones. That may be intended; it is not
obviously so, and it is worth a decision.
