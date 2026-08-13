# Brain Infrastructure Gate — deployment package

**Nothing here has been applied.** These are reviewable artifacts for a future
private Brain deployment. No host was modified, no service installed, no
firewall rule written.

Every value that depends on the host is a `«PLACEHOLDER»`. Nothing about the
distro, init system, firewall, service account, or paths is assumed — that is
what `host-inspection.sh` is for.

## Facts, read from source

| Fact | Value | Source |
| --- | --- | --- |
| Start command | `node dist/src/server.js` | `apps/brain-service/package.json` |
| Bind host | `MIGRAPILOT_BRAIN_HOST`, default `127.0.0.1` | `src/config/env.ts:57` |
| Bind port | `MIGRAPILOT_BRAIN_PORT`, default `3988` | `src/config/env.ts:58` |
| Health endpoint | `GET /health` | `src/server.ts:215` |
| Local/dev state fallback | `MIGRAPILOT_STATE_DB`, default `$CWD/migraai-state.db` | `src/server.ts:240` |
| Governed coding | `MIGRAPILOT_CODING_ENABLED`, `MIGRAPILOT_CODING_WORKSPACE_ROOTS` | env scan |

### ⛔ Persistence is a blocker, not a configuration choice

**MigraPilot production persistence is PostgreSQL (Prisma), per MigraTeck
database standards. brain-service does not implement it.**

Verified in source, not assumed:

| Evidence | Location |
| --- | --- |
| Only a SQLite adapter exists | `src/engine/persistence/` contains solely `sqliteStore.ts` |
| SQLite is hardcoded | `src/server.ts:62` imports `SqliteDurableStore`; `let durable: SqliteDurableStore \| undefined` |
| No adapter selection | no `STORE_KIND` / `PERSISTENCE` / `USE_POSTGRES` env var exists |
| No database dependency | `package.json` has no `prisma`, `@prisma/client`, or `pg` |
| Driver is the Node built-in | `import { DatabaseSync } from 'node:sqlite'` |
| Postgres is explicitly *future* | `types.ts:6` — *"a Postgres+pgvector adapter **can** back a hosted/multi-tenant deployment **later**"* |

`migraai-state.db` is a **local/development fallback**, not production
architecture. It must not be treated as canonical state, and `sqlite3 .backup`
is **not** part of the production backup design — PostgreSQL backup, restore and
ownership follow existing MigraTeck database standards.

**Implementing the PostgreSQL adapter against the existing store interface is a
prerequisite development task.** Until it exists, acceptance check 11 fails
closed and production deployment is blocked by design. `MIGRAPILOT_STATE_DB` is
deliberately left unset in the environment template.

## Filesystem layout

| Purpose | Path | Mutability | Notes |
| --- | --- | --- | --- |
| Application code | `«BRAIN_APP_DIR»` | replaced on upgrade | `ProtectSystem=strict` keeps it read-only at runtime |
| Runtime working dir | `«BRAIN_DATA_DIR»` | survives upgrades | `ReadWritePaths` target. **Not** the canonical database — durable state belongs in PostgreSQL |
| Logs | journald (`SyslogIdentifier=brain-service`) | — | `«BRAIN_LOG_DIR»` declared only if file logging is added |
| Backups | PostgreSQL, per MigraTeck database standards | — | not VM-local; the guest's PBS snapshot is DR coverage, not the database backup |
| Environment | `«BRAIN_ENV_FILE»` | root-owned, `0640` | may hold provider/gateway secrets |

## Network model

```
Internet ──► nginx ──► consumer Next.js server ──► ⟨private⟩ ──► brain-service
                                                                 :3988

Internet ─╳─► brain-service          no public DNS, no vhost, no ingress rule
Browser  ─╳─► brain-service          unreachable by construction
```

- **If the consumer runs on the same host:** keep `MIGRAPILOT_BRAIN_HOST=127.0.0.1`.
  Nothing off-host can connect, and no firewall rule is needed. This is the
  simplest correct answer and should be preferred.
- **If the consumer runs elsewhere:** bind the verified private interface
  address, and add an allow-rule scoped to the consumer host's address only.

`0.0.0.0` is never a valid deployment value here. Binding all interfaces is
precisely what turns a private service public.

Conceptual firewall intent, to be expressed in whatever framework the host
actually uses (do not assume ufw):

| Source | Destination | Action |
| --- | --- | --- |
| consumer application tier address | Brain `:3988` | allow |
| explicitly approved admin/dev source | Brain `:3988` | allow, if genuinely required |
| everything else, incl. general LAN and public | Brain `:3988` | deny |

Note: network isolation alone is not authentication. Any host permitted to
reach the port can still assert any `X-Owner-Scope`, because the Brain trusts
that header (`memoryRoutes.ts:23`). The allow-list must therefore stay as narrow
as the architecture permits.

## Application-to-Brain authentication

The Brain already implements a trusted-gateway pattern —
`x-migrapilot-principal` + `x-migrapilot-gateway-secret`, validated against
`MIGRAPILOT_GATEWAY_SECRET` (`src/engine/capability/operatorPrincipal.ts:77-101`),
which explicitly discards an asserted principal that arrives without the secret.

**Today it is wired only into `engineerRoutes.ts`.** It does not protect
`/api/ai/conversations`, so enabling it does not secure the consumer path by
itself. It is, however, the in-house precedent for extending identity-aware auth
to `/api/ai/*` as defence in depth — a Brain code change, tracked separately, not
a deployment setting.

## Health contract

| Check | Command |
| --- | --- |
| Service state | `systemctl is-active brain-service` |
| Local health | `curl -fsS http://127.0.0.1:3988/health` |
| From app tier | `curl -fsS http://«BRAIN_PRIVATE_ADDR»:3988/health` |
| Restart policy | `systemctl kill -s SIGKILL brain-service` then confirm auto-restart and health recovery |
| Clean shutdown | `systemctl stop brain-service`, confirm no WAL corruption on restart |
| Not public | from an unauthorized host: connection to `:3988` must fail |

## Consumer configuration

`BRAIN_BASE_URL` is set **only** in the consumer server environment
(`apps/migrapilot-consumer/.env`), never as `NEXT_PUBLIC_*`. It is read by
`src/server/brain/config.ts`, which is `server-only`.

No browser-facing Brain route exists, and none should be added: Phase 1 route
handlers must call the seams in `src/server/brain/seams.ts` server-side.

## Order of operations

1. `bash deploy/host-inspection.sh > brain-host-facts.txt` — **read-only**, paste output back.
2. Fill every `«PLACEHOLDER»` from those facts. Nothing is applied until this is done.
3. Install service account, directories, environment file (root, bounded commands).
4. Install and enable the unit; verify health and restart behaviour.
5. Apply network restriction; verify from an unauthorized source that it fails.
6. Configure consumer `BRAIN_BASE_URL`; verify server-side reachability.
7. Run `deploy/acceptance/identity-isolation.mjs` and require a clean result.

## Acceptance harness

```bash
CONSUMER_BASE_URL=https://consumer.internal \
BRAIN_BASE_URL=http://127.0.0.1:3988 \
TEST_SESSION_COOKIE='migrapilot_consumer_session=…' \
TEST_SUBJECT_A=<oidc-sub> \
BRAIN_DEPLOYED_HOST=<deployed-host-or-ip> \
node deploy/acceptance/identity-isolation.mjs
```

Reports PASS / FAIL / SKIP per check. **A SKIP is not a pass** — the harness
says so explicitly and exits non-zero only on FAIL, so read the skip list.

Checks 3–5 are expected to SKIP until Phase 1 adds a consumer write route;
there is nothing to drive a scope through yet. Checks 1, 2, 6, 8, 9, 10 are
meaningful the moment Brain is deployed.
