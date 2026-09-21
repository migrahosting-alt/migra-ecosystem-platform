# Auth handoff — the staging session ends silently around the token boundary

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
