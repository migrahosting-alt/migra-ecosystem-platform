# MigraPilot staging — what it is, and what it is not

_Built 2026-09-12; brought to parity the same day. Every value below was read from the
running environment, not recalled._

Staging exists so a build runs somewhere real before it runs where customers are.
It is deliberately a **separate runtime authority** — its own host, units, release
roots, env files, database, tailnet identity and OAuth client — and deliberately
**not** a separate behaviour: there is no staging mode in the code, because an
environment full of exceptions proves nothing about the build you later promote.

## 1. Where it lives

| | Staging | Production |
| --- | --- | --- |
| Host | **CT101 `migrapilot-core`**, 10.10.0.12 — an LXC on `pve` | VM111 `migrapilot-app-core`, 10.10.0.13 |
| Tailnet | `migrapilot-staging-core` · **100.83.46.93** · owner `migrahosting@` | `migrapilot-app-core` · 100.95.14.29 · owner `migrahosting@` |
| Brain unit | `migrapilot-staging-brain.service` | `migrapilot-brain.service` |
| Brain bind | 127.0.0.1:3988 | 127.0.0.1:3988 |
| Consumer unit | `migrapilot-staging-consumer.service` | `migrapilot-consumer.service` |
| Consumer bind | 10.10.0.12:3000 | 10.10.0.13:3000 |
| Brain releases | `/opt/migrapilot-staging/brain-service/{releases,current}` | `/opt/migrapilot/brain-service/{releases,current}` |
| Consumer releases | `/opt/migrapilot-staging/consumer/{releases,current}` | `/opt/migrapilot/consumer/{releases,current}` |
| Env | `/etc/migrapilot-staging/{brain,brain-postgres,consumer}.env`, mode 600 | `/etc/migrapilot/*.env` |
| Database | **db-core `migrapilot_brain_stage`**, PostgreSQL **16.15**, role `migrapilot_brain_stage_app` | db-core `migrapilot_brain`, PostgreSQL 16.15 |
| Inference | `http://100.86.143.93:11434/v1` over Tailscale | the same endpoint |
| Node | 22.23.2 | 22.23.2 |
| Logs | `/opt/migrapilot-staging/logs/{brain,consumer}.log` | journal |
| Reached by | SSH tunnel to `http://127.0.0.1:3200` | `https://chat.migrateck.com` |

The roots, units and env paths are the ones `docs/migrapilot/deploy-targets.sh`
already declared for the `staging` target. One line of that contract is
deliberately not satisfied — see §7.

## 2. What is deployed

Both services serve commit **`3c204aa8`**, release **`staging-3c204aa8`**, and say
so from a `RELEASE.json` stamped into the build:

```
brain    /api/version  commit 3c204aa8…  release staging-3c204aa8  buildId sha256:99b11c3d…  stamped true
consumer /api/version  commit 3c204aa8…  release staging-3c204aa8  buildId JrmsZXVpn6rLJ1n0F-beV  stamped true
```

`3c204aa8` is HEAD minus documentation commits. It carries the whole Gmail /
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
- `MIGRAAUTH_API_URL=http://100.101.3.99:4120` — where **this server** calls
  `/token` and `/userinfo`, over Tailscale, as production does.

The back-channel needs the private path for the same reason VM111 does:
`auth.migrateck.com` resolves to the edge in front of the hypervisor, so a
container behind that edge hairpins and times out while the browser connects
normally. CT101 was measured doing exactly that — `https=000` after 10s to the
public name, `200` to the private one.

**Verified live**: sign-in through the tunnel returned the real owner profile
(`8c32a204-…`, `myspeedteck@gmail.com`), survived two service restarts and the
database move, and `/api/capabilities` answers **19 capabilities, 16 available**.

## 5. Tailscale and inference

CT101 is an **unprivileged** container, so Tailscale needed `/dev/net/tun`, which
no container on this hypervisor had. `/etc/pve/lxc/101.conf` gained exactly two
lines (backup at `/root/101.conf.bak-2026-09-12`):

```
lxc.cgroup2.devices.allow: c 10:200 rwm
lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file
```

The node joined as `migrapilot-staging-core`, user-owned like VM111 rather than
tagged, brought up with `--accept-dns=false --accept-routes=false --ssh` so it
takes an address and nothing else: container DNS and routing are untouched.

The container restart this required doubled as a **reboot-survival proof** — both
units and the database came back on their own with no intervention.

Inference is configuration, not a hard-coded endpoint: the Brain's own provider
registry reads `MIGRAPILOT_LOCAL_PROVIDER=openai-compat` and
`MIGRAPILOT_PROVIDER_URL`, and routes through its normal admission path.

```
/health  inferenceProviders: available
         gpuCapacity: ready   reason: headroom-available
         residentModels: ["qwen2.5-coder:14b"]   residentVramBytes: 15286560357
```

That is a real probe of the workstation's GPU across the tailnet, not a
declaration. **The stub is what used to make this look fine when it wasn't**:
`probe()` returns `reachable: true` for a stub provider by definition, so all
four profiles reported healthy while nothing could generate. `gpuCapacity` was
the field telling the truth.

**End-to-end, through the real UI and the API:**

| | |
| --- | --- |
| API turn | 200 in 9.96s — "The result of 17 multiplied by 3 is 51." |
| UI turn | typed in the composer, answered *Tokyo*, persisted to `conv_1qdu8s4mdtirww3ueiacg` |
| confirmation turn | 200 in 5.6s — "STAGING PARITY OK" |
| model | `llama3.1:8b`, provider `local` |
| durable | 2 conversations / 4 messages present in `migrapilot_brain_stage` on db-core |

🚨 **The model was chosen by the Brain's capability router, not by the profile
default.** The configured profiles are `qwen2.5-coder:14b`; the router answered
with `llama3.1:8b`. That is the routing path working as designed, and it also
means the profile values matter less than they look. Those values mirror the
**local development Brain** — production's `/etc/migrapilot/brain.env` is
root-only and holds secrets, so it was not read. **Worth confirming they match
production before staging is trusted as a behavioural gate.**

## 6. Rollback — exercised, not asserted

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
is serving, copied read-only from it, carrying its own `0f494d27` stamp. A real
prior release, which is what makes the rollback a rollback.

It was run both ways **twice** — once on first build, and again after the
Tailscale, inference and db-core moves — and the running processes reported the
change each time:

| | brain `/api/version` | consumer `/api/version` |
| --- | --- | --- |
| before | `3c204aa8` / `staging-3c204aa8` | `3c204aa8` / `staging-3c204aa8` |
| after rollback | **`0f494d27` / `chat-platform-rc-0908`** | **`0f494d27` / `chat-platform-rc-0908`** |
| after roll-forward | `3c204aa8` / `staging-3c204aa8` | `3c204aa8` / `staging-3c204aa8` |

`/health` answered 200 in every state. Worth recording: the **older Brain started
cleanly against the newer schema** (migration 28, created by `3c204aa8`). A schema
rollback was neither needed nor attempted, and nothing here proves one would be safe.

**Retention** uses the existing `scripts/release-retention.sh`, which now takes
`--base=` instead of assuming the production root — staging keeps releases in the
same shape under a different prefix, and a second copy of the script would have
been a second policy. Installed on CT101 at `/usr/local/bin/release-retention.sh`:

```sh
release-retention.sh --base=/opt/migrapilot-staging --keep=1     # plan
release-retention.sh --base=/opt/migrapilot-staging --keep=1 --apply
```

`--keep=1` caps staging at three: active, rollback target, one spare. The script
resolves the active release and the rollback target by pointer and by open file
handle, prints a keep-reason for every directory, and deletes nothing without
`--apply`. Current plan: both releases KEEP, nothing to prune.

## 7. What staging does NOT yet do

1. 🚨 **`deploy-brain.sh --target staging` still cannot run — one ACL rule away.**
   `DEPLOY_HOST=migrapilot-staging-core` now resolves from the workstation via
   MagicDNS, and Tailscale SSH is enabled on the node. The connection reaches it
   and is refused by policy: *"tailnet policy does not permit you to SSH to this
   node."* An SSH rule in the tailnet ACL is the remaining step, and it is a
   security-policy change for the owner — not something to add quietly. Until
   then staging is deployed by hand and the scripts' boot-test and identity-check
   steps are not being exercised.
2. **`DEPLOY_CONSUMER_BIND=127.0.0.1`** is not satisfied: the consumer binds
   `10.10.0.12` so the tunnel can reach it through `pve`. Production binds its own
   LAN address too, so this matches production and it is the contract line that is
   out of step.
3. **Governance is unsigned.** No qualification signing key, so every governed
   mutation is refused and the governed model families stay unavailable. Note
   production reports the same for `chat.general`, `reasoning.deep`, `chat.fast`
   and `chat.long_context` — this is not a staging-only gap.
4. **Email/Gmail is deliberately absent.** No `MIGRAPILOT_GOOGLE_*`, no public
   origin. The Brain reports `EMAIL CONNECT DISABLED` — the ordinary state before
   an operator creates a client. Nothing in Google Cloud was touched.
5. **Project connect is off** — the PostgreSQL store has no project-binding
   repository, and the Brain refuses to serve the feature from memory.
6. **No speech runtime** — the composer's Dictate control is correctly disabled
   and says why.
7. **Disk is the ceiling**: 4.0 GB free of 12 GB with two release sets installed.
   That is what `--keep=1` is for.

## 8. Things that had to change on the host

- **Node 20.20.2 → 22.23.2** (NodeSource), matching production exactly. Node 20
  has no `node:sqlite`, which the Brain imports at module load, so it could not
  start at all. Nothing else on CT101 runs Node.
- **`/dev/net/tun` passed through** to the unprivileged container (§5).
- **`migrapilot_app` created on db-core** — already present there, so migration 4
  took its existing-role branch. On the short-lived CT101 PostgreSQL it had to be
  created first: that migration creates the role, which is superuser-only, so the
  Brain could not migrate a database owned by an ordinary role. Provisioning
  creating it first is what the migration's own comment asks for.
- **PostgreSQL 15 on CT101 is stopped and disabled.** It served as the bootstrap
  database for one hour and is now superseded by db-core. Its DSN is kept at
  `/etc/migrapilot-staging/brain-postgres.env.ct101-pg15.bak`; using it again
  means re-enabling `postgresql` on CT101. Two staging databases would be two
  authorities, which is the drift this project keeps paying for.

The staging credential was generated on the host, piped machine-to-machine into
db-core, and written straight into a 0600 env file. It never passed through a
terminal, a transcript or an agent's context.

`/opt/migrapilot` on CT101 is a stopped July 2026 install belonging to something
else. It was not touched.

## 9. Isolation from production — measured

```
pg_database ACL   migrapilot_brain       = {migrapilot_brain=CTc/migrapilot_brain}
                  migrapilot_brain_stage = {postgres=CTc/postgres,migrapilot_brain_stage_app=Tc/postgres}

has_database_privilege('migrapilot_brain_stage_app','migrapilot_brain','CONNECT')  →  FALSE
```

PUBLIC has no CONNECT on the production database and the staging role is not
granted it. Sizes stay separate: `migrapilot_brain` 200 MB, `migrapilot_brain_stage`
9.5 MB.

## 10. Production, re-verified after all of this

```
chat.migrateck.com/api/version  →  0f494d27 / chat-platform-rc-0908 / AV5gDWNOlGsz3wDMI-NIf
brain-service/current           →  releases/chat-platform-rc-0908
consumer/current                →  releases/chat-platform-rc-0908
migrapilot-brain.service        →  active
migrapilot-consumer.service     →  active
migrapilot_brain                →  200 MB, untouched
```

Unchanged. The only interaction with VM111 in this work was reading two release
directories out of it.
