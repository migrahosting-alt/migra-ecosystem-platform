# MigraPilot staging — what it is, and what it is not

_Built 2026-09-12. Every value below was read from the running environment, not recalled._

Staging exists so a build runs somewhere real before it runs where customers are.
It is deliberately a **separate runtime authority** — its own host, units, release
roots, env files, database and OAuth client — and deliberately **not** a separate
behaviour: there is no staging mode in the code, because an environment full of
exceptions proves nothing about the build you later promote.

## 1. Where it lives

| | Staging | Production |
| --- | --- | --- |
| Host | **CT101 `migrapilot-core`**, 10.10.0.12 — an LXC on `pve`, reached with `pct exec` | VM111 `migrapilot-app-core`, 10.10.0.13 |
| Brain unit | `migrapilot-staging-brain.service` | `migrapilot-brain.service` |
| Brain bind | 127.0.0.1:3988 | 127.0.0.1:3988 |
| Consumer unit | `migrapilot-staging-consumer.service` | `migrapilot-consumer.service` |
| Consumer bind | 10.10.0.12:3000 | 10.10.0.13:3000 |
| Brain releases | `/opt/migrapilot-staging/brain-service/{releases,current}` | `/opt/migrapilot/brain-service/{releases,current}` |
| Consumer releases | `/opt/migrapilot-staging/consumer/{releases,current}` | `/opt/migrapilot/consumer/{releases,current}` |
| Env | `/etc/migrapilot-staging/{brain,brain-postgres,consumer}.env`, mode 600 | `/etc/migrapilot/*.env` |
| Database | PostgreSQL **15.19 on CT101**, database and role `migrapilot_staging` | PostgreSQL 16.15 on db-core, database `migrapilot_brain` |
| Logs | `/opt/migrapilot-staging/logs/{brain,consumer}.log` | journal |
| Reached by | SSH tunnel to `http://127.0.0.1:3200` | `https://chat.migrateck.com` |

The roots, units and env paths are the ones `docs/migrapilot/deploy-targets.sh`
already declared for the `staging` target. Two lines of that contract are not yet
satisfied — see §6.

## 2. What is deployed

Both services serve commit **`3c204aa8`**, release **`staging-3c204aa8`**, and say
so from a `RELEASE.json` stamped into the build:

```
brain    /api/version  commit 3c204aa8…  release staging-3c204aa8  buildId sha256:99b11c3d…  stamped true
consumer /api/version  commit 3c204aa8…  release staging-3c204aa8  buildId JrmsZXVpn6rLJ1n0F-beV  stamped true
```

`3c204aa8` is HEAD minus one documentation commit. It carries the whole Gmail /
capability-owned-rendering line of work that production does not have.

## 3. Reaching it

```sh
ssh -N -L 127.0.0.1:3200:10.10.0.12:3000 pve
```

Then `http://127.0.0.1:3200`. That origin is not incidental — it is the exact
origin the staging OAuth client is registered for, so it must not be changed
without changing the client too.

## 4. Identity

A **separate, staging-only** MigraAuth client. The local-development client was
not touched and still carries only its own `:3000` callback.

| | |
| --- | --- |
| client_id | `migrapilot-consumer-staging_UXO9zoqUpD` |
| type | `web`, `requires_pkce: true`, `token_auth_method: none` → **no secret exists** |
| redirect | `http://127.0.0.1:3200/api/auth/callback` (exactly one) |
| post-logout | `http://127.0.0.1:3200` |
| scopes | `openid profile email offline_access` |

Two origins, and they are genuinely different questions:

- `MIGRAAUTH_BASE_URL=https://auth.migrateck.com` — where the **browser** is sent.
- `MIGRAAUTH_API_URL=http://10.10.0.10:4120` — where **this server** calls
  `/token` and `/userinfo`.

The back-channel needs the private address for the same reason VM111 does:
`auth.migrateck.com` resolves to the edge in front of the hypervisor, so a
container behind that edge hairpins and times out while the browser connects
normally. CT101 was measured doing exactly that — `https=000` after 10s to the
public name, `200` to `10.10.0.10:4120`.

**Verified live**: sign-in through the tunnel returned the real owner profile
(`8c32a204-…`, `myspeedteck@gmail.com`) and `/api/capabilities` answered with 19
capabilities — which also proves the authenticated consumer → Brain path.

## 5. Rollback — exercised, not asserted

Staging keeps release directories and swaps a symlink, per app, exactly as
production does. The operation is one line per service:

```sh
ln -sfn /opt/migrapilot-staging/brain-service/releases/<REL> /opt/migrapilot-staging/brain-service/current \
  && systemctl restart migrapilot-staging-brain.service

ln -sfn /opt/migrapilot-staging/consumer/releases/<REL> /opt/migrapilot-staging/consumer/current \
  && systemctl restart migrapilot-staging-consumer.service
```

Releases present in both roots: `staging-3c204aa8`, `chat-platform-rc-0908`.

`chat-platform-rc-0908` is the **production baseline** — the built artifact VM111
is serving, copied read-only from it, carrying its own `0f494d27` stamp. It is a
real prior release, not a placeholder, which is what makes the rollback a rollback.

It was run, both ways, and the running processes reported the change:

| | brain `/api/version` | consumer `/api/version` |
| --- | --- | --- |
| before | `3c204aa8` / `staging-3c204aa8` | `3c204aa8` / `staging-3c204aa8` |
| after rollback | **`0f494d27` / `chat-platform-rc-0908`** | **`0f494d27` / `chat-platform-rc-0908`** |
| after roll-forward | `3c204aa8` / `staging-3c204aa8` | `3c204aa8` / `staging-3c204aa8` |

`/health` answered 200 in every state. Worth recording: the **older Brain started
cleanly against the newer schema** (the staging database is at migration 28, which
`3c204aa8` created). A schema rollback was neither needed nor attempted, and
nothing here proves one would be safe.

## 6. What staging does NOT yet do

Each of these is a real gap, not a nuance.

1. **`deploy-brain.sh --target staging` cannot run.** The target names
   `DEPLOY_HOST=migrapilot-staging-core`, which does not resolve; CT101 is reached
   by `pct exec` from `pve`, and the deploy scripts need `ssh $HOST` plus a
   privileged account. Until that exists, staging is deployed by hand and the
   scripts' boot-test and identity-check steps are not being exercised. Granting
   it means installing an SSH key into the container — an access change for the
   owner to approve, not for an agent to make quietly.
2. **`DEPLOY_CONSUMER_BIND=127.0.0.1`** is not satisfied: the consumer binds
   `10.10.0.12` so the tunnel can reach it through `pve`. Production binds its own
   LAN address too, so this matches production and it is the contract line that is
   out of step.
3. **No inference.** No provider is configured, so `/health` reports
   `gpuCapacity: unavailable, reason inference-unreachable`. Chat will not produce
   answers. Production reaches the workstation's models over Tailscale; CT101 is
   not on Tailscale, and putting it there is a network decision, not a build step.
4. **Governance is unsigned.** No qualification signing key, so every governed
   mutation is refused. The Brain says so at boot.
5. **Email/Gmail is deliberately absent.** No `MIGRAPILOT_GOOGLE_*`, no public
   origin. The Brain reports `EMAIL CONNECT DISABLED` — the ordinary state before
   an operator creates a client. Nothing in Google Cloud was touched.
6. **Project connect is off** — the PostgreSQL store has no project-binding
   repository, and the Brain refuses to serve the feature from memory.
7. **PostgreSQL 15.19 vs production's 16.15.** A genuine parity gap; the Brain's
   migrations ran clean on 15, but staging is not proving production's engine.

## 7. Things that had to change on the host

- **Node 20.20.2 → 22.23.2** (NodeSource), matching production exactly. Node 20
  has no `node:sqlite`, which the Brain imports at module load, so it could not
  start at all. Nothing else on CT101 runs Node.
- **PostgreSQL installed**, with database and role `migrapilot_staging`. The
  password was generated on the host and written straight into
  `/etc/migrapilot-staging/brain-postgres.env` (mode 600); it never passed through
  a terminal or a transcript.
- **`migrapilot_app` created as `NOLOGIN NOBYPASSRLS`.** Migration 4 creates it and
  that is superuser-only, so the Brain's own migration failed against a database
  owned by an ordinary role. Provisioning creating it first is what the migration's
  own comment asks for. The Brain connects as `migrapilot_staging`, which is not a
  superuser and does not bypass RLS — and every policy is `FORCE ROW LEVEL
  SECURITY`, so the table owner is subject to it too.

`/opt/migrapilot` on CT101 is a stopped July 2026 install belonging to something
else. It was not touched.

## 8. Production, re-verified after all of this

```
chat.migrateck.com/api/version  →  0f494d27 / chat-platform-rc-0908 / AV5gDWNOlGsz3wDMI-NIf
brain-service/current           →  releases/chat-platform-rc-0908
consumer/current                →  releases/chat-platform-rc-0908
migrapilot-brain.service        →  active
migrapilot-consumer.service     →  active
```

Unchanged. The only interaction with VM111 in this work was reading two release
directories out of it.
