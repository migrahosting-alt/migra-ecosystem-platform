# Auth handoff — the staging session ends silently around the token boundary

> ## 🚨 RETRACTED 2026-09-26 — READ THIS FIRST
>
> **The premise of this document is withdrawn.** It claimed a ~15–20 minute session
> lifetime. That number was never a measurement of session lifetime: it was the gap
> between the owner SAYING they had signed in and me OBSERVING a logout. I never
> established when the session was actually created, so I never measured what I
> reported.
>
> Reading the mechanism end to end afterwards found **no code path that produces a
> short session**:
>
> | mechanism | value | source |
> | --- | --- | --- |
> | app session TTL | **12 hours** | `resolveAuthPort.ts` default, no staging override |
> | cookie `maxAge` | tracks `expiresAt` | `auth-client/session.js` |
> | token renewal | **preserves** `expiresAt`, never shortens it | `persistRenewal` |
> | anonymous identity | 30 days | `anonymousIdentity.ts` |
>
> A session created ~12 hours before I looked, expiring during my window, fits every
> observation — including nine sign-ins spread across six days.
>
> **Also retracted: the "nothing is logged" finding.** The unit writes to
> `/opt/migrapilot-staging/logs/consumer.log`, not journald. I grepped journald. A
> pre-existing `[auth]` logger was there the whole time.
>
> What survives is below, marked. The rest of this document is kept for the record
> rather than deleted, because another lane may already have read it.


Owner-routed 2026-09-20 from the Chat lane. **It blocks the staging owner test**,
which is why it jumped the queue: PPTX, stopped answers and the conversation-state
batch are all waiting on a session that survives a person thinking for twenty
minutes.

## Acceptance target (owner's words)

> Keep an authenticated MigraPilot staging session alive beyond the 15-minute
> access-token lifetime, including an idle period, then successfully perform an
> authenticated action without manual re-login. Prove whether refresh fired,
> whether rotation succeeded, and whether the renewed credentials were persisted.
> If refresh fails, emit enough structured evidence to identify the failing stage
> without logging secrets.

### The four cases to cover

1. active session, chatting continuously past 15 minutes
2. idle 20–30 minutes, then upload or send
3. two near-simultaneous authenticated requests at refresh time
4. browser reload shortly before, and shortly after, access-token expiry

### The logging gap is part of the fix

An operator must be able to distinguish, without any token or credential reaching
a log:

```
access token expired -> refresh attempted -> refresh succeeded/failed
                     -> renewal persisted/failed -> reauthentication required
```

Today there is **nothing**: `journalctl -u migrapilot-staging-consumer.service` has
no auth, refresh, reauth or 401 line across the entire window in which a live
session became an unauthenticated one. A session that ends leaving no record is its
own defect — there is nothing for an operator to read.

## What the Chat lane measured, so it is not re-derived

| time | state |
| --- | --- |
| 19:16:47 | consumer restarts (deploy cutover) |
| 19:17–19:23 | **signed in** — files uploaded, chats run as the owner |
| 19:42 | **signed out** — "Sign in to attach documents", 401 on `/api/files`, `/api/images` |

No restart between 19:23 and 19:42. An earlier occurrence matched at ~21 minutes.

🚨 **It is NOT the deploy.** The Chat lane reported that first and it was wrong:
the session survived the 19:16:47 cutover and worked for six minutes after it. The
logout is time-based.

## The lead — and the unknown that decides whether it is the cause

`migraAuthApi.ts` mints `accessTokenExpiresAt` from `(expires_in ?? 900) - 30`, a
**15-minute** default, which matches the observed interval.

The refresh machinery exists and is well built — one-time rotation, in-flight
de-duplication keyed by a hash of the token, and an explicit `persistRenewal`
because replaying a rotated refresh token revokes the whole family.

**But the ordinary request path does not appear to reach it.** `getSession()` returns
whatever the auth port holds and applies `isLive`:

```ts
const isLive = (session) => session !== null && !(session.expiresAt && session.expiresAt <= Date.now())
```

That is a pure expiry comparison with **no refresh attempt**. The refresh calls in
`migraAuthApi` sit on the path that calls MigraAuth's own endpoints, not on the path
an ordinary MigraPilot request takes to upload a file or send a turn.

### 🚨 THE UNKNOWN, and it decides everything above

**Is `AppSession.expiresAt` the ACCESS-TOKEN expiry, or a longer session expiry?**

- If it tracks the 15-minute access token, the lead above is the cause: ordinary
  requests go dead at the token boundary with no refresh on that path.
- If it is a longer session expiry, the lead is wrong and the failure is inside
  `@migrateck/auth-client` or the rotation/persist step instead.

The Chat lane did **not** determine this. `AppSession` is defined in `authPort.ts`
with `expiresAt: number` and no stated semantics, and the implementation lives in
`@migrateck/auth-client`. Reading that is the auth lane's call, and guessing at
token rotation from this lane is the scope creep the programme keeps refusing.

**Check that first.** It is one question and it tells you which half of this document
to act on.

## Explicitly out of scope for the Chat lane

Rewriting MigraAuth internals, changing token lifetimes, or touching rotation. The
Chat lane's involvement ends at the measurement, this lead, and the named unknown.


---

## SURVIVING FINDINGS — what is still worth the auth lane's time

These were measured, not inferred, and none depends on the retracted premise.

### 1. 🚨 The OAuth redirect points at a port nothing serves

```
APP_BASE_URL           = http://127.0.0.1:3200
MIGRAAUTH_REDIRECT_URI = http://127.0.0.1:3200/api/auth/callback
service listens on     = 3000
```

The consumer serves on **3000**; sign-in is redirected to **3200**. The log carries
two `callback exchange failed: Invalid OAuth state` entries, which is what an
interrupted callback looks like.

Stated carefully: cookies are scoped by HOST, not by port, so this does not
partition sessions between ports and is **not** a logout mechanism. It is a real
configuration inconsistency that makes sign-in depend on someone happening to
forward 3200.

### 2. `MIGRAAUTH_CLIENT_SECRET` is not set on staging

`migraAuthApi.ts` asserts in a comment that *"the deployed environment has
`MIGRAAUTH_CLIENT_SECRET` set, so the environment is taken as the authority over
the comment"*, and warns that omitting it for a confidential client "turns every
refresh into an unexplained 401". **That comment is false for staging.**

Still a lead, not a cause: nothing observed shows a failed refresh ending a
session, and `reauth_required` is consumed only by account-management routes.

### 3. The instrumentation that now measures the real thing

`server/auth/authTrace.ts`, deployed in `authtrace-0926b` and **verified firing**
against the real service. `session_expired` carries `livedSeconds`;
`session_absent` distinguishes a vanished cookie from a refused one.

This is what should have produced the number in the retracted premise. If a
premature-expiry defect exists, the next occurrence now writes its own evidence —
and if none exists, the absence of those lines is equally informative.

## What the auth lane should NOT spend time on

Hunting a 15-minute session lifetime. It is not in the code, not in the
configuration, and was never measured.
