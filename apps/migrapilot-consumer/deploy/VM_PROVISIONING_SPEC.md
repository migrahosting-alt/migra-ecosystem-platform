# MigraPilot VM — provisioning specification

**Status: proposal. Nothing provisioned, nothing deployed.**

The dedicated MigraPilot VM is **required architecture that does not yet exist**.
Confirmed absent from `~/.ssh/config` (14 aliases), `.migra/infra.snapshot.json`
(15 hosts), the live ecosystem inventory, and the live Tailscale tailnet
(17 devices).

Values below marked **[DISCOVER]** must come from Proxmox facts, not from this
document. Everything else is derived from repository evidence, cited inline.

---

## 1 · Role

One VM hosting the full MigraPilot consumer stack:

```
Internet
   │  TLS
   ▼
nginx-proxy-core            ← existing central ingress (evidence §4)
   │  plain HTTP over Tailscale/LAN
   ▼
migrapilot-core  ← THIS VM
   ├─ migrapilot-consumer (Next.js 16)   :3000
   │        └──► 127.0.0.1:3988
   └─ brain-service (Node 22)            :3988  loopback only
            └─ persistent state outside the release tree
```

Brain gets **no public hostname, no ingress route, no LAN listener**. It is
reachable only from the consumer process on the same host.

`pilot-api` / `pilot-web` on `10.10.0.7` are out of scope and stay put.

---

## 2 · VM specification

| Attribute | Value | Basis |
| --- | --- | --- |
| VM name | `migrapilot-core` | every ecosystem host uses the `*-core` suffix — `app-core`, `db-core`, `cloud-core`, `dns-core`, `mail-core`, `voip-core`, `turn-core`, `migrapanel-core`, `nginx-proxy-core` |
| Hostname | `migrapilot-core` | same |
| VM ID | **[DISCOVER]** | must follow the existing ID convention on the node |
| OS | Ubuntu 24.04.x LTS (Noble) | matches the current dev baseline and the ecosystem's Ubuntu nginx builds; Node 22 is available from the standard repos |
| Filesystem | ext4 | matches the observed baseline (`/dev/sdf ext4`) |
| Firmware / machine | UEFI (OVMF), `q35` | modern default; confirm against existing VMs — **[DISCOVER]** |
| QEMU guest agent | **enabled** | required for clean shutdown, backup fsfreeze, and IP reporting |
| Boot on host start | **yes** | this is a supervised production service host |
| Network bridge | **[DISCOVER]** | must match what existing VMs use |
| VLAN tag | **[DISCOVER]** | only if the node's bridges are VLAN-aware |
| LAN address | static, **[DISCOVER]** | ecosystem uses `10.10.0.x` (db-core `.6`, migrapanel-core `.7`, cloud-core `.3`) and `10.1.10.x`; the correct subnet depends on the bridge |
| Tailscale | **enrol, tagged device** | every ecosystem Linux host is on the tailnet; this is also how nginx-proxy-core reaches some backends (§4) |
| Public DNS | **none for Brain.** Consumer hostname (e.g. `chat.migrateck.com`) resolves to the **ingress**, never to this VM | §4 |

### Sizing

Brain is **not** a GPU inference host in this deployment, and this is evidence
rather than assumption: `src/config/env.ts:62` defaults
`localProvider` to **`'stub'`**, and `src/engine/providers/types.ts:15` supports
`'ollama' | 'openai-compat' | 'anthropic' | 'stub'`. Cloud routing needs no
local accelerator. **Do not allocate a GPU.**

The workload is two Node processes plus a SQLite database.

| | vCPU | RAM | Root disk | Data disk |
| --- | --- | --- | --- | --- |
| **Minimum viable** | 2 | 4 GB | 40 GB | — (subdirectory) |
| **Recommended start** | 4 | 8 GB | 60 GB | 50 GB separate |
| **Scale-up trigger** | see below | | | |

Recommended sizing reasoning: Next.js production SSR sits comfortably in
~512 MB–1 GB; brain-service is a Fastify process whose memory is dominated by
SQLite page cache and in-flight request buffers; `next build` is the peak
consumer and benefits from 4 vCPU. 8 GB leaves headroom for the OS, journald,
and a build running concurrently with serving.

**Scale-up triggers — revisit sizing when any becomes true:**

1. **A local model provider is adopted** (`MIGRAPILOT_LOCAL_PROVIDER=ollama`).
   This changes the machine class entirely — GPU plus 32 GB+ — and should be a
   separate host, not a resize of this one.
2. **Governed coding is enabled** (`MIGRAPILOT_CODING_ENABLED=true`) — validation
   commands spawn child processes and need CPU headroom and a real workspace.
3. **SQLite state exceeds ~40 % of the data disk**, or WAL checkpoints lengthen.
4. **Sustained CPU > 60 %** or memory pressure/swap under normal load.
5. Builds performed on-host rather than shipping a prebuilt artifact.

---

## 3 · Storage layout

**Durable Brain state belongs in PostgreSQL, not on this VM.** MigraPilot's
production persistence architecture is Prisma + PostgreSQL, following MigraTeck
database standards for ownership, backup and restore.

⛔ **brain-service does not implement that yet** — see `deploy/README.md` for the
source evidence. `migraai-state.db` is a local/development fallback only.
Acceptance check 11 fails closed while a local SQLite store would be used, and
while no PostgreSQL adapter exists. The VM therefore hosts *no* canonical
database, and `/var/lib/migrapilot/brain` is a runtime working directory rather
than the system of record.

| Path | Purpose | Mutability |
| --- | --- | --- |
| `/opt/migrapilot/brain-service/releases/<version>` | Brain release | replaced on upgrade |
| `/opt/migrapilot/brain-service/current` → symlink | active release | repointed atomically |
| `/opt/migrapilot/consumer/releases/<version>` | consumer release | replaced on upgrade |
| `/opt/migrapilot/consumer/current` → symlink | active release | repointed atomically |
| `/var/lib/migrapilot/brain/` | Brain runtime working dir (**not** the database) | survives upgrades |
| `/var/backups/migrapilot/` | reserved; **not** the database backup path | retained per policy |
| `/etc/migrapilot/brain-service.env` | Brain env, `root:migrapilot-brain 0640` | secrets |
| `/etc/migrapilot/consumer.env` | consumer env, `root:migrapilot-consumer 0640` | secrets |
| journald | logs | `SyslogIdentifier` per service |
| `PrivateTmp=yes` | temp files | per-service, auto-cleaned |

A separate data disk mounted at `/var/lib/migrapilot` is recommended so state
capacity and snapshots are managed independently of the OS disk.

### Database backup

**Not a VM-local concern.** Durable state lives in PostgreSQL, so backup,
retention, restore drills and database ownership follow the existing MigraTeck
database standards — not a bespoke procedure invented for this host.

The Proxmox/PBS job covering VM 111 is **disaster-recovery coverage for the
guest** (OS, releases, configuration). It is not, and must not be presented as,
the database backup.

Any earlier reference in this package to `sqlite3 .backup`, WAL/SHM handling, or
a VM-local database file was written before the persistence audit and has been
removed. It described the development fallback, not production architecture.

---

## 4 · Network and ingress design

**TLS terminates centrally at `nginx-proxy-core`.** Evidence: 27 enabled vhosts
carry `ssl_certificate`, and upstreams are plain HTTP — 34 × `127.0.0.1`, plus
`10.1.10.5x`, `10.10.0.7`, and Tailscale addresses such as `100.111.4.85`
(voip-core). Only 3 upstreams use `https://`, i.e. exceptions rather than the
rule. Certificates live at `/etc/letsencrypt/live/<domain>/` on the proxy.

**Therefore: do not terminate public TLS on the MigraPilot VM.** Follow the
standard — `nginx-proxy-core` holds the certificate for the consumer hostname
and proxies plain HTTP to this VM over Tailscale or LAN, exactly as
`migrapilot.migrateck.com` already proxies to `10.10.0.7:3377`.

A local nginx on this VM is **optional and probably unnecessary** initially;
Next.js serves directly on `:3000`. Add one only if local path routing or static
caching is later required.

Brain, restated as configuration:

- `MIGRAPILOT_BRAIN_HOST=127.0.0.1` — loopback only, never `0.0.0.0`
- no vhost, no DNS record, no firewall opening, no LAN listener
- consumer reaches it as `BRAIN_BASE_URL=http://127.0.0.1:3988`, server-side only

Because Brain is loopback-bound and co-located, **no Brain firewall rule is
required at all** — there is nothing off-host to permit or deny. The host
firewall needs only: consumer port from the ingress address, and SSH/Tailscale
administration.

⚠️ Co-location means loopback is the trust boundary. Any process on this VM can
reach Brain and assert any `X-Owner-Scope` (`memoryRoutes.ts:23`). That is
acceptable because the VM is dedicated and single-purpose — and it is the
argument for keeping it dedicated, plus for the tracked `/api/ai/*`
gateway-secret hardening as the second enforcement layer.

---

## 5 · Service identities

Two separate unprivileged accounts, no login shell, no home directory:

| Service | User : Group | Rationale |
| --- | --- | --- |
| Brain | `migrapilot-brain` | sole owner of `/var/lib/migrapilot/brain` |
| Consumer | `migrapilot-consumer` | no access to Brain state whatsoever |

Separation is **materially useful here**, not ceremony: the consumer is the
internet-facing process. If it were compromised, distinct accounts mean the
attacker gains the consumer's environment but not filesystem access to the Brain
database — they would still have to go through the loopback API. Same-user
operation would hand over the SQLite file directly.

Neither runs as root. Both env files are `0640`, owned `root:<service-group>`.

---

## 6 · Unresolved facts discovery must answer

| # | Question | Blocks |
| --- | --- | --- |
| 1 | Proxmox version and node name(s) | every `qm` command |
| 2 | Free VM ID and the ID convention in use | VM creation |
| 3 | Storage pools, types, free capacity | disk placement |
| 4 | Network bridges and VLAN awareness | `net0` configuration |
| 5 | Existing Ubuntu 24.04 template or cloud image | install method |
| 6 | Cluster or single node | HA/replication options |
| 7 | Host CPU/RAM headroom | whether recommended sizing fits |
| 8 | Backup storage and existing job schedule | backup policy alignment |
| 9 | Correct LAN subnet/gateway for the chosen bridge | static IP |
| 10 | Existing VM naming/tagging conventions | consistency |

---

## 7 · Next step

Run `deploy/proxmox-discovery.sh` against `pve` — **read-only**, changes
nothing. Its output resolves the table above, after which the bounded
VM-create commands can be generated against real facts.
