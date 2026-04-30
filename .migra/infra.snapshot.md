# Migra Infrastructure Snapshot (2026-04-01)

## 1. Canonical Servers
- **pve:** `100.73.199.109` - Hypervisor
- **nginx-proxy-core:** `100.101.106.88` - Edge NGINX and public proxy
- **app-core:** `100.101.3.99` - Primary application host
- **migrapanel-core:** `100.68.175.27` - Panel API
- **db-core:** `100.77.51.91` - PostgreSQL
- **cloud-core:** `100.113.190.42` - Cloud storage/services
- **dns-core:** `100.126.11.116` - Primary DNS
- **mail-core:** `100.114.228.57` - Mail transport and IMAP
- **voip-core:** `100.111.4.85` - Voice/PBX

## 2. Naming Note
- `srv1-web` has been retired.
- `app-core` replaces the former shared web host role.
- `dns-core` and `mail-core` are now split dedicated services.

## 3. Active Tenant Pods (LXCs)
- **pod-premtint (137):** `10.1.10.54` - **Running** (Premier Tint)
- **pod-lituationdjs (139):** `10.1.10.53` - **Running**
- **pod-holisticgroupllc (138):** `10.1.10.52` - **Running**
- **pod-elizefoundation (136):** `10.1.10.51` - **Running**
- **migra-stacks (110):** `10.1.10.104` - **Running**

## 4. Core Services
- **migrapanel-panel-api:** Host `migrapanel-core` | Status `online` | Mem `693.0mb` | Uptime `7h`

## 5. Routing Table (nginx-proxy-core)
- **migrapanel.com** -> `migrapanel-core (100.119.105.93:3020)`
- **premtint.com** -> `10.1.10.54` (LXC 137)
- **lituationdjs.com** -> `10.1.10.53` (LXC 139)
- **intake.migrahosting.com** -> `100.119.105.93:3020`
- **migrahosting.com** -> `127.0.0.1:4242`

---
*Snapshot updated from the confirmed server inventory on 2026-04-01.*
