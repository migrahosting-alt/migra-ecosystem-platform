# Migra Email — OAuth boundary (DESIGNED, NOT PROVISIONED)

**Status: no credentials exist.** Nothing here is implemented, no Google Cloud
project has been created, and no secret is stored anywhere in this repository.
This document exists so that when Bonex creates the credentials, the shape they
drop into is already decided and reviewed.

## The one-sentence rule

The browser never holds a refresh token, and the server never accepts a
provider account id from the client without resolving ownership first.

Everything below follows from those two.

## Why this is written before the code

An OAuth integration has three places where a mistake is invisible until it is
catastrophic: where the refresh token lives, who is allowed to name an account,
and what happens when a grant is revoked. All three are cheap to get right at
design time and expensive to retrofit, because each one is load-bearing for
every request afterwards.

## 1. Credential storage authority

Refresh tokens are **server-side only**, in the durable store the Brain already
owns, under the same persistence contract as project bindings and idempotency
records.

- **Never** in `localStorage`, a cookie, a client-readable response body, or a
  JWT claim.
- **Never** in logs, telemetry, error messages, or metric labels.
- The access token is short-lived and also stays server-side; the browser has
  no reason to hold either, because the browser never calls Google directly.

The adapter already enforces the runtime half of this: `GmailProvider` keeps
its config in an ES `#private` field with an explicit `toJSON`, after a test
caught `JSON.stringify(provider)` serialising the access token in plain text.
TypeScript's `private` would not have prevented that.

## 1a. How the refresh token is stored — BUILT

Sealed with AES-256-GCM before it reaches the database, under a key held
**outside** the database in `MIGRAPILOT_MAIL_TOKEN_KEY` (32 bytes, base64).

The claim is narrow and worth stating exactly: the durable store already holds
sensitive things — conversations, documents. A refresh token is a different
*kind* of thing. It is a credential to a system that is not ours, it opens the
user's actual mailbox from anywhere with no Migra process involved, it survives
a Migra password change, and it does not expire on its own. So a dump of the
store — a backup on a laptop, a snapshot restored into staging, a forgotten
replica — would be a permanent key to every connected mailbox. Encryption under
an external key makes the dump insufficient on its own.

🚨 **The associated data is the point, not a detail.** GCM's AAD binds each
ciphertext to `owner + workspace + provider + provider account id + purpose`,
length-prefixed so two different bindings cannot serialise identically.
Encryption alone stops a *reader* of the database and does nothing about a
*writer*: without AAD an attacker connects their own mailbox, copies their own
sealed refresh token into a victim's row, and every "my email" question the
victim asks reads the attacker's inbox. That is the same graft the callback's
principal check refuses, arriving through the storage layer instead of the
browser.

🚨 **A seal that will not open is an operator fault, not a user fault.** If the
key is wrong or missing, every connection in the deployment fails to open. The
tempting classification is `authorization_expired` — and it is exactly wrong,
because that state's remedy is "reconnect", and reconnecting overwrites a good
row to work around a misconfigured environment variable, destroying the
evidence. It surfaces as provider unavailability instead.

Other decisions this settled:

- **A grant with no refresh token is refused, not stored.** The authorization
  URL always asks for offline access and forces consent, so it is anomalous;
  storing it would create a connection that works for an hour and then asks for
  reconnection forever, indistinguishable from a real revocation.
- **A refresh never writes the refresh token.** Google does not reissue one on
  an ordinary refresh, so a statement that updated both columns would
  eventually overwrite the one credential that cannot be recovered.
- **Row-level security is enabled AND forced** on `mail_connection`, and every
  statement also carries an explicit scope predicate. The predicate is what a
  reviewer sees in a diff; RLS is what holds when someone forgets one.
- **Durability is a capability on the store contract**, not an `instanceof`
  check. That check is exactly how the project binding ended up in memory on
  production while every local test passed.
- **`MIGRAPILOT_MAIL_TOKEN_KEY` missing does not stop the Brain booting.** The
  email capability reports as unconfigured and names the variable; a feature
  nobody has enabled must not prevent startup.

### Known gap, recorded not fixed

`conversation_project` (migration 25) has no row-level security, unlike every
other scoped table. It is outside this work and needs its own migration.

## 1b. The redirect URI — GENERATED, not transcribed from here

Do **not** copy a URI out of this document into the Google Cloud console. This
document would then be the source of truth and the code a copy of it, and the
first drift would be found by a user whose sign-in bounced with
`redirect_uri_mismatch`.

`googleConsoleSetup(publicOrigin)` in `oauthConfig.ts` returns the two exact
values the console needs — the authorized redirect URI and the authorized
JavaScript origin — built from the same `CALLBACK_PATH` constant the callback
route serves, and asserted exactly in test. Run it against the deployment's
`MIGRAPILOT_PUBLIC_ORIGIN` and enter what it prints.

`http://localhost` is accepted **outside production only**. A production
deployment that fell back to it would send every user's consent redirect to
their own machine, where nothing is listening — and the symptom would look like
Google rejecting the app rather than a misconfiguration.

## 1c. Provider construction

`providerFor()` takes a scope, a provider name, and its dependencies. It takes
**no access token and no account address** — a factory that accepted one would
behave identically for a legitimate caller and for a request that carried one,
and the difference would live in whether every route remembered not to pass it
through. Removing the parameter removes the question.

When a principal has several mailboxes, the server enumerates the ones that
principal owns and the user picks. A picked value is matched against that list
rather than used to look anything up — and an unrecognised one resolves as
though nothing was named, because "that account is not yours" confirms the
account exists.

## 2. Account ownership

A connection record binds:

| Field | Meaning |
|---|---|
| `ownerScope` | the Migra principal, as every other durable row uses |
| `providerAccountId` | Google's stable account identifier |
| `accountAddress` | for display only — it changes, and is not an identity |
| `scopes` | read / draft / send, recorded separately |
| `connectedAt`, `lastRefreshAt` | provenance |

🚨 **The client never names an account.** A request says "my mail", and the
server resolves which connection that means from the authenticated principal.
Accepting a `providerAccountId` from the browser would let one user read
another's mailbox by changing a parameter — the same class as the
caller-supplied project root refused in the project lane, and the reason
`data/users/me` exists rather than `data/users/<id>`.

If a principal has several connected accounts, the *server* enumerates the ones
that principal owns and the user picks from that list. The picked value is
validated against ownership again before use, never trusted because it came
back from a page we rendered.

## 3. Refresh path

1. An operation needs a token.
2. The stored access token is used if it is still valid.
3. If expired, refresh **server-side** using the stored refresh token.
4. On success, persist the new access token and continue.
5. On failure, classify — see below. **Never** retry a refresh in a loop.

Refresh is not attempted concurrently for one connection: two in-flight
refreshes race and one of them persists a token the provider has already
superseded. A single-flight guard per connection, in the same shape as the
idempotency claim.

## 4. Revoked and expired semantics

These are **different states with different remedies**, and the code already
distinguishes them:

| Provider condition | Migra state | What the user is told |
|---|---|---|
| No connection row | `not_connected` | "Email is not connected yet." |
| Refresh returns `invalid_grant` | `authorization_expired` | "Your email account needs reconnecting." |
| Refresh works, scope missing | `insufficient_scope` | "Connected for reading only." |
| Network/5xx | `provider_unavailable` | "Email is unavailable right now." |

🚨 `invalid_grant` means the user revoked access in their Google account, or
the token aged out. It must **not** delete the connection row: the row records
that they *did* connect, which is what makes the remedy "reconnect" rather than
"start from nothing". Deleting it would erase the distinction the whole state
model is built on.

A revoked grant also **fails an in-flight send**, because authorization is
rechecked after approval and before dispatch. That is already implemented and
mutation-tested.

## 5. Read and send scopes

Requested and recorded **separately**:

- `gmail.readonly` — search, read, threads, attachment metadata and bytes
- `gmail.compose` — provider-side draft creation (a mailbox mutation)
- `gmail.send` — dispatch

A user may reasonably connect for reading only. The capability reports
`readAvailable` and `sendAvailable` independently for exactly this reason; a
single boolean would hide working search or promise a send that is refused at
dispatch.

**Ask for read first.** A consent screen requesting send on first connection
asks for the irreversible permission before the product has shown it can do
anything useful.

## 6. What the browser may see

- That an account is connected, and its display address.
- Which capabilities are available, with the engine's own reason when not.

Nothing else. No token, no scope strings, no Google account id, no OAuth error
codes. The consumer-side guard already fails if any consumer source names a
provider or an OAuth concept in code.

## What is NOT decided here

- Which Google Cloud project, and who owns it — Bonex's.
- Whether the controlled test account is a Workspace user or a personal one.
- Verification status, which affects how many users may connect and whether the
  consent screen shows an unverified-app warning.

## Blocker

Bonex creates the Google Cloud project, the OAuth client, and the controlled
test account. The agent must never create, request, read back, or store those
credentials. When they exist, the environment variable names and where to paste
them will be stated — and the values never read back.
