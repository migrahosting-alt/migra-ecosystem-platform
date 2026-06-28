> Curated from confirmed operational memory as of 2026-06. Verify specifics before acting.

# Server Topology

8 core servers on a Tailscale tailnet, plus a dedicated TURN host. **Always pick the right host for a task — never guess the IP.**

| Server | Tailscale IP | Role | SSH alias |
|---|---|---|---|
| **app-core** | 100.101.3.99 | General application runtime (non-panel/mail/DNS/VoIP apps): AnnouPale (`annoupale-web`/`annoupale-api`), pale-api, MigraTeck console (`migrateck` :3111), auth-api/central auth (:4120), identity-service (:4001), marketing-backend, migrastock (:3220), staging-auth web (:4821). LAN IP **10.10.0.10** | `ssh-app` |
| **cloud-core** | 100.113.190.42 | Cloud platform / CloudPods / VPS internal services | `ssh-cloud` |
| **db-core** | 100.77.51.91 | PostgreSQL central data layer (`:5432`). No frontend apps. Hosts `migrapanel`, `auth_migrateck_stage`, `migrastock`, and more. LAN IP **10.10.0.6** | `ssh-db` |
| **dns-core** | 100.126.11.116 | DNS, nameservers, domain automation (PowerDNS). LAN IP near 10.10.0.9 | `ssh-dns` |
| **mail-core** | 100.114.228.57 | MigraMail backend — Postfix/Dovecot, delivery, mailboxes, routing. LAN IP **10.10.0.8** (Tailscale SSH may time out → reach via Proxmox-host jump) | `ssh-mail` |
| **migrapanel-core** | 100.68.175.27 | MigraPanel panel-api + Client Portal static + billing + voice-gen + Business Phone UI/API. LAN IP **10.10.0.7**. Deploy panel-api here | `ssh-panel` |
| **nginx-proxy-core** | 100.101.106.88 | Reverse proxy / public routing / SSL-TLS termination (70+ vhosts). Also hosts migramail backends (:3010, :3013). LAN IP **10.10.0.2** (edge) | `ssh-proxy` |
| **voip-core** | 100.111.4.85 | FreePBX / Asterisk 21, MigraVoice call execution, SIP, call routing. LAN IP **10.10.0.4** | `ssh-voip` |
| **turn-core** | 100.89.188.74 (TS) · 138.201.255.24 (public eth0) | MigraVoice WebRTC TURN/STUN (coturn), `turn.migrahosting.com`. SSH user `ubuntu` | `ssh ubuntu@100.89.188.74` |

> Note: migrapanel-core has historically also been referenced as `100.119.105.93` / SSH alias `core`; that address has appeared **stale/dead** in some configs and caused an outage (see `03-ops-hazards.md`). Prefer `100.68.175.27` / LAN `10.10.0.7`.

## Routing rules for tasks
- **panel-api / portal / billing / invoices / voice-gen / Business Phone UI** → migrapanel-core (100.68.175.27 / 10.10.0.7)
- **FreePBX / PBX runtime / dialplan / recordings / IVR** → voip-core (100.111.4.85)
- **Database** → db-core (100.77.51.91)
- **DNS** → dns-core (100.126.11.116)
- **Mail / mailboxes / routing** → mail-core (100.114.228.57)
- **Public proxy / TLS** → nginx-proxy-core (100.101.106.88)
- **Generic apps (AnnouPale, console, auth, migrastock)** → app-core (100.101.3.99)
- **Cloud / VPS infra** → cloud-core (100.113.190.42)

## Public edge / NAT facts
- **Shared public egress IP `138.201.255.55`**: voip-core, nginx-proxy-core, dns-core, cloud-core all sit behind a shared NAT and egress as this IP. On-host interfaces are private (`10.10.0.x` / `10.30.0.x`). `ns2` is a separate IP `138.201.255.35`; mail public IP `138.201.255.45`.
- Inbound port-forwarding by service: 80/443 → nginx-proxy-core, 53 → dns-core, SIP/RTP → voip-core. voip-core WebSocket ports 8088/8089 are **not** edge-forwarded — reach them over Tailscale.
- **NO NAT hairpin:** an internal host cannot reach `138.201.255.55` from inside. Test external reachability from a truly off-net host / public resolver, not server-to-server.
- **app-core has no DNS hairpin:** from inside app-core, public hostnames (e.g. `https://annoupale.com`) time out. On-host scripts/health probes MUST use loopback: AnnouPale API `http://127.0.0.1:3100`, web `http://127.0.0.1:3101`; pale-api `http://127.0.0.1:4005`; console `/console` local. Public URLs are valid only for off-host clients.
- **control.migrahosting.com / auth.migrateck.com edge:** public → `138.201.255.55` (pve) → iptables DNAT :443 → `10.10.0.2` (edge/TLS host) → reverse-proxy to app-core (10.10.0.10) where auth-api(4120)/identity(4001)/marketing run.

## CloudPod / Proxmox facts
- Single Proxmox node **`pve`** = `138.201.255.55` (NOT clustered).
- Template CT **VMID 9000** (`cloudpod-template`), storage **`pod-data`**, network bridge **`vmbr30`**, subnet **`10.30.0.x/24`**, gw `10.30.0.1`.
- Reserved IPs: `10.30.0.1` (gw), `10.30.0.11` (nginx-proxy-core eth1) — pod IP allocation starts at `.12`.
- Guest pod hostname pattern: `<slug>-<shortid>.pods.migrahosting.com` (wildcard DNS live).

## Health-check patterns
- panel-api: `ssh root@100.68.175.27 'curl -s http://127.0.0.1:3020/health'` → `{"ok":true,"service":"panel-api"}`
- portal internal (hairpin-safe): `http://10.10.0.7:3020` or local vhost with `--resolve control.migrahosting.com:443:127.0.0.1`
- pale-api: `curl 127.0.0.1:4005/api/health`
