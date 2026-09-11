# Getting the consumer into a legitimately authenticated local session

**Why this exists.** The backend path for Migra Email is an acceptance candidate, and the
consumer UI has never been exercised end to end because it has no owner session. This is the
shortest honest route to one. Nothing here weakens authentication, and nothing here asks anyone
to hand a secret to an assistant.

_Verified 2026-09-11 against the running code, not from memory._

---

## What is already true

| Fact | Evidence |
| --- | --- |
| The consumer boots and fails **closed** without auth config | `[auth] MigraAuth not configured (missing: …). Running fail-closed.` |
| MigraAuth is reachable and serving discovery | `GET https://auth.migrateck.com/.well-known/openid-configuration` → 200 |
| It supports **public clients** | `token_endpoint_auth_methods_supported: ["none", "client_secret_post"]` |
| The consumer uses **PKCE S256** | authorize URL carries `code_challenge_method=S256` |
| The Brain default already points at the local Brain | `BRAIN_BASE_URL` defaults to `http://127.0.0.1:3988` |
| `.env.local` and `.env` are gitignored here | `git check-ignore` confirms both |

🚨 **Only five variables are actually required.** The resolver reads several more, but these are
the only ones it refuses to start without — `MIGRAAUTH_CLIENT_SECRET`, `MIGRAAUTH_API_URL`,
`MIGRAAUTH_WEB_URL`, `MIGRAAUTH_SCOPES` and `MIGRAAUTH_POST_LOGOUT_REDIRECT_URI` all have working
defaults or are optional. A public PKCE client needs **no client secret**.

---

## The narrow path, located (audited 2026-09-11)

MigraAuth has a per-client API. **Use it. Do not run the bulk seed.**

| | |
| --- | --- |
| Audit existing clients | `GET /v1/clients` — what this user can see |
| Create exactly one | `POST /v1/clients` |
| 🚨 Do **not** use | `MigraTeck/apps/auth-api/src/seed.ts` — an upsert pass that rewrites every client |
| Developer console (live, 200) | `https://auth.migrateck.com/developers/apps` |

Both routes sit behind `requireSession`, so **an owner session is required to audit or create** —
there is no unauthenticated way to look, which is correct and is exactly why I stopped here.

The create contract (`createOAuthClientSchema`):

```
client_name        MigraPilot Consumer (local development)
client_type        public
redirect_uris      ["http://127.0.0.1:3000/api/auth/callback"]
allowed_scopes     ["openid","profile","email","offline_access"]
requires_pkce      true
token_auth_method  none
```

`redirect_uris` is validated with a plain `z.string().url()` — there is **no https-only rule**, so a
loopback `http://` callback is accepted.

## The one thing only the owner can do

A public OAuth client must exist at `https://auth.migrateck.com` for this local app, with:

- **redirect URI** — `http://127.0.0.1:3000/api/auth/callback` _(exact; this is the route that exists)_
- **grant** — `authorization_code` + PKCE `S256`
- **token endpoint auth** — `none` (public client)
- **scopes** — `openid profile email offline_access`

**Sign in at `https://auth.migrateck.com`.** Once you have, I can drive the developer console to
audit the existing clients and create this one if none is suitable — that is sanctioned by
`CLAUDE.md` after a manual login. I cannot get there alone: both the list and the create sit
behind a session, by design.

🚨 **One dedicated client, created through `POST /v1/clients`.** Never the seed: it upserts the
whole registry, and adding a single local client that way is how the others get silently
reshaped.

If a suitable public client already exists, its id is all that is needed and nothing is created.

---

## Then write `apps/migrapilot-consumer/.env.local`

Five lines. Do not paste any of these values into a chat.

```
APP_BASE_URL=http://127.0.0.1:3000
APP_SESSION_SECRET=<generate: openssl rand -base64 48>
MIGRAAUTH_BASE_URL=https://auth.migrateck.com
MIGRAAUTH_CLIENT_ID=<the public client id>
MIGRAAUTH_REDIRECT_URI=http://127.0.0.1:3000/api/auth/callback
```

`APP_SESSION_SECRET` is yours to generate and keep; it signs this app's own session and is not
shared with MigraAuth.

---

## Proof that five is enough

Run with those five set to placeholder values and the app stops being fail-closed and issues a
real authorize redirect:

```
GET /api/auth/login
→ 302 https://auth.migrateck.com/authorize
     ?response_type=code&client_id=…&redirect_uri=http%3A%2F%2F127.0.0.1%3A3000%2Fapi%2Fauth%2Fcallback
     &scope=openid+profile+email+offline_access&code_challenge=…&code_challenge_method=S256&state=…
```

That was measured with a deliberately unregistered client id, in the shell only, never written
to a file — it proves the **wiring**, not a login. MigraAuth correctly rejects an unregistered
client, which is the point.

---

## Then: the acceptance run

Start the Brain (it holds the connected QA mailbox) and the consumer, sign in as the owner, and
run these six prompts in one conversation against the same real mailbox:

1. `Find the email containing MIGRA_EMAIL_SENTINEL_0909`
2. `Summarize that email`
3. `What attachments are on it?`
4. `What are the exact values in the spreadsheet attached to it?`
5. `Summarize the thread`
6. Reload the page, then `What was that email about?`

**Confirm, in the rendered UI:** the answer, the attachment list, the exact spreadsheet values,
the thread summary's formatting, and the contextual follow-up — and that there are **no** hidden
notices, stale headings, missing facts or fabricated filenames.

What the backend produced for the same six, paced, 8/8 each, is recorded in
`MIGRAPILOT_STATUS.json` under `capabilityOwnedRendering_2026_09_11`. Step 3's attachment
membership was identical 20/20.

🚨 Only after the owner passes that live UI run does the status move from
**READY FOR OWNER PRODUCT ACCEPTANCE — backend path only** to
**OWNER PRODUCT ACCEPTANCE — PASS**.
