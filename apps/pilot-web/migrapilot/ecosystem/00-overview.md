> Curated from confirmed operational memory as of 2026-06. Verify specifics before acting.

# MigraTeck / MigraHosting — Ecosystem Overview

**MigraTeck** is the parent company/ecosystem; **MigraHosting** is its web-hosting + client platform brand. The ecosystem is a fleet of products (hosting, voice, mail/drive, payments, a social platform, plus prototypes) running across an 8-server Tailscale-connected fleet (see `01-server-topology.md`). Several products share one Postgres data layer on **db-core** and one customer panel API (**panel-api**) on **migrapanel-core**.

A recurring, ecosystem-wide trait: **multiple products' production source-of-truth is ON-HOST, not in git** (panel-api, client portal frontend, pale-api, migramail backend, staging-auth web). Always confirm what actually runs before editing or deploying (see `04-canonical-sources.md`).

## App portfolio at a glance

| Product | What it is | Code / canonical source |
|---|---|---|
| **MigraPanel — Client Portal** | Customer-facing hosting control center at `control.migrahosting.com/client` (Dashboard/Billing/Services/Domains/Profile + modules) | Frontend SPA `apps/website/src/client/` on branch `client-portal/canonical` @ `migrahosting-alt/MigraHosting_Marketing`; built `vite build --base=/client/`; served static at `migrapanel-core:/opt/MigraPanel/apps/client-portal/` |
| **MigraPanel — panel-api** | Backend API powering the portal: accounts, billing, invoices, domains, email, voice-gen, Business Phone, CloudPod provisioning | ON-HOST source-of-truth `migrapanel-core:/opt/MigraPanel/apps/panel-api/src` (runs via `tsx`, edited in place, NOT git). Local `dev/New Migra-Panel` is DIVERGENT — never deploy it |
| **MigraPanel Control Center (Console)** | Internal ops dashboard at `console.migrateck.com/console` — ecosystem grid, system map, health, AnnouPale/Pale ops modules | `MigraTeck/apps/web/src/app/console/` (Next 16). PRs go to `migrahosting-alt/MigraTeck-web` via `web` remote. Runs on app-core, atomic releases under `/opt/migra/releases/migrateck/` |
| **AnnouPale (Pale)** | Social/media platform (web + mobile + admin/compliance) | Nested git `apps/pale-platform` → `migrahosting-alt/annoupale`. Backend `pale-api` at `app-core:/opt/pale/backend` (PM2 `pale-api` :4005). Web/api deploy → `app-core:/opt/annoupale/{web,api}` (PM2 `annoupale-web` :3101 / `annoupale-api` :3100) |
| **MigraVoice / Business Phone** | Cloud phone service: TTS voice prompts, DIDs, IVR, queues; mobile app receives call alerts (in-app answer WIP) | PBX runtime on **voip-core** (FreePBX/Asterisk). Voice-gen + Business Phone UI/API in panel-api. Mobile: bare RN + Expo `Software/MigraVoice/mobile`. Console `voice.migrahosting.com` |
| **MigraMail (webmail)** | Webmail + mail backend (delivery, mailboxes, routing) | Backend `nginx-proxy-core:/opt/migramail-web-backend` (PM2/systemd `migramail-web-backend.service` :3010, dist-only). Source `migrahosting-alt/MigraMail` branch `feat/migramail-web-app`. Mobile: Capacitor `com.migrateck.migramail` |
| **MigraMail — panel backend** | Console Mail module backend (isolated from the entangled standalone webmail) | `migramail-panel-api.service` on **nginx-proxy-core** :3013, dir `/opt/migramail-panel-api` |
| **MigraDrive** | Flutter cloud-storage app (per-user MinIO/S3), email+password auth via the webmail backend | Flutter `migradrive/apps/migradrive_app/` (gitignored in dev repo). Same backend as MigraMail. Play app `com.migrateck.migradrive` |
| **MigraPay** | Canonical billing system (Stripe customer = MigraTeck LLC); MigraPanel proxies it for payment-method reads/renewals | Lives in **auth-api** Prisma 7 schema @ `AUTH_DATABASE_URL` (auth-api on app-core `10.10.0.10:4120`). Stripe secrets on auth-api, NOT panel-api |
| **MigraCMS Enterprise** | Standalone Next 15 + Prisma CMS / visual builder (block editor, content modeling, headless API, commerce) | `migracms-enterprise/` (own nested git, gitignored from parent). DB `migracms-postgres` :5440. First prod site: Compassion Funeral Chapel |
| **MigraStock Intelligence** | Desktop-first stock decision-support app (scoring v2, watchlists, portfolio, reports, AI briefs) — no trading | `Software/Stock Intelligence/` (Next 16 + Prisma 7). Live `migrastock.migrahosting.com` (app-core :3220). DB `migrastock` on db-core |
| **TAP (Haiti)** | HTG digital-payment MVP (Creole UI) + offline Android APK | `Software/Tap/` (Next 16 + Tailwind v4). APK `com.migrateck.tap` (Capacitor 8) |
| **MigraShield VPN** | Tauri + React desktop VPN client (mock tunnel, brand-design stage) | `apps/migrashield-vpn/` (Tauri 2 + React 19 + Vite) |
| **MigraPilot** | Internal local-AI ops/engineering agent (this consumer) — chat + tools + approval gate + vision + image-gen, all local via Ollama | `apps/pilot-web` (Next 15), route `/pilot`. Branch `redesign/pale-control-center` |
| **Compassion Funeral Chapel** | First production MigraCMS site (memorial/funeral) | Inside MigraCMS (slug `compassion-funeral-chapel`), served from CloudPod CT100 |
| **MigraTeck unified-auth (central auth)** | Central OAuth/identity (auth.migrateck.com); staging at staging-auth.migrateck.com | auth-api `app-core 10.10.0.10:4120`; staging web on `:4821`. Source ON-HOST `/opt/migra/repos/migrateck-auth-stage/` |

## Cross-cutting architecture notes
- **Client portal data:** every portal page consumes `GET /api/portal/account/context` via `useAccount()` and derived hooks (`useServices`, `useInvoices`, `useDomains`, `useEmail`, etc.). Modules must not become a separate source of truth.
- **Billing:** MigraPay (auth-api) is canonical for payment methods/renewals; panel-api proxies it behind feature flags + a tenant allowlist (pilot = Elize). Stripe secrets never cross to panel-api.
- **CloudPods:** customer hosting = LXC containers on a single Proxmox node `pve` (138.201.255.55), storage `pod-data`, template VMID 9000, network bridge `vmbr30` / `10.30.0.x`.
