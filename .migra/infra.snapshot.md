# Migra Infrastructure Snapshot (2026-04-01)

## 1. Canonical Servers
- **pve:** `100.73.199.109` - Hypervisor
- **srv1-web:** `100.68.239.94` - Edge NGINX
- **migrapanel-core:** `100.119.105.93` - Panel API
- **db-core:** `100.98.54.45` - PostgreSQL
- **cloud-core:** `100.120.118.39` - Cloud storage/services
- **dns-mail-core:** `100.81.76.39` - Mail + DNS
- **voip-core:** `100.111.4.85` - Voice/PBX

## 2. Naming Note
- `dns-mail-core` is the unified mail and DNS server.
- Older docs that mention `vps-core`, `mail-core`, or `dns-core` are legacy naming unless they are explicitly historical records.

## 3. Active Tenant Pods (LXCs)
- **pod-premtint (137):** `10.1.10.54` - **Running** (Premier Tint)
- **pod-lituationdjs (139):** `10.1.10.53` - **Running**
- **pod-holisticgroupllc (138):** `10.1.10.52` - **Running**
- **pod-elizefoundation (136):** `10.1.10.51` - **Running**
- **migra-stacks (110):** `10.1.10.104` - **Running**

## 4. Core Services
- **migrapanel-panel-api:** Host `migrapanel-core` | Status `online` | Mem `693.0mb` | Uptime `7h`

## 5. Routing Table (srv1-web)
- **migrapanel.com** -> `migrapanel-core (100.119.105.93:3020)`
- **premtint.com** -> `10.1.10.54` (LXC 137)
- **lituationdjs.com** -> `10.1.10.53` (LXC 139)
- **intake.migrahosting.com** -> `100.119.105.93:3020`
- **migrahosting.com** -> `127.0.0.1:4242`

---
*Snapshot updated from the confirmed server inventory on 2026-04-01.*
