# MigraTeck / MigraHosting – Infra Notes for Copilot

These notes are for GitHub Copilot and any AI assistant working on this codebase.

---

## Tailscale VPN Hosts (Preferred)

Use these Tailscale IPs for SSH access:

| Alias | Purpose | Tailscale IP | LAN IP |
|-------|---------|--------------|--------|
| `pve` | Proxmox host | 100.73.199.109 | - |
| `srv1-web` | Main web/hosting node | 100.68.239.94 | 10.1.10.10 |
| `cloud-core` | MinIO / object storage | 100.120.118.39 | - |
| `db-core` | PostgreSQL database | 100.98.54.45 | 10.1.10.210 |
| `dns-core` | PowerDNS authoritative | 100.73.241.82 | 10.1.10.102 |
| `mail-core` | Primary mail (Postfix/Dovecot) | 100.64.119.23 | 10.1.10.101 |
| `mail-vps` | Legacy/secondary mail VPS | 100.123.151.26 | - |
| `mpanel-core` | mPanel backend API | 100.97.213.11 | 10.1.10.206 |
| `vps-web-hosting` | Client sites VPS | 100.119.108.65 | - |
| `srv2` | Old node (legacy, rarely used) | 100.87.67.45 | - |

### SSH Commands

```bash
ssh mpanel-core    # mPanel backend (primary)
ssh pve            # Proxmox hypervisor
ssh db-core        # PostgreSQL
ssh srv1-web       # Web server
```

---

## Core Servers (LAN)

Legacy LAN addresses (use Tailscale when possible):

- `srv1-web` – 10.1.10.10 – main nginx web server (client websites)
- `mpanel-core` – 10.1.10.206 – mPanel backend (Node/Express, queues, APIs)
- `dns-core` – 10.1.10.102 – PowerDNS authoritative DNS
- `mail-core` – 10.1.10.101 – Postfix/Dovecot mail server
- `db-core` – 10.1.10.210 – central database host

---

## High-level Rules

- Prefer **small, focused edits**
- Assume these machines are **production**
- **CRITICAL:** See [FIREWALL-CONFIG.md](./FIREWALL-CONFIG.md) before modifying firewall on pve

---

## Firewall Management (IMPORTANT)

⚠️ **Before touching UFW/iptables on pve**, read [FIREWALL-CONFIG.md](./FIREWALL-CONFIG.md)

**Quick verification:**
```bash
ssh root@100.73.199.109 "bash /root/verify-firewall.sh"
```

**If VMs lose internet/Tailscale:**
```bash
ssh root@100.73.199.109 "bash /root/restore-firewall.sh"
```
- Only change core configs when explicitly requested (nginx, PowerDNS, Postfix, Dovecot, firewall, etc.)
- When unsure, propose changes in comments instead of modifying critical files directly
- **Always use Tailscale aliases** for SSH commands (e.g., `ssh mpanel-core` not `ssh mhadmin@10.1.10.206`)
