# MigraTeck Ecosystem Command Center — Copilot Handoff

**You are picking up the data-wiring work for the Command Center. Claude built the UI shell, auth system, deployment pipeline, and wired a handful of panels. Most panels still display "Unknown" / 0% / empty states because their underlying queries target tables that either don't exist or have different schemas than expected.**

Your job: wire the remaining panels to real production tables, and build out the per-module sub-pages (`/console/hosting`, `/console/email`, `/console/voice`, etc.). The UI design + components stay with Claude; you focus on data + backend wiring.

**Live URL**: `https://console.migrateck.com` (auth: `admin@migrateck.com` / password is in `CONSOLE_ADMIN_PASSWORD_HASH` on app-core)

---

## 1. Architecture (read first)

```
Browser
   │
   ▼
nginx-proxy-core (100.101.106.88)
   │  vhost: console.migrateck.com.conf, cert: /etc/letsencrypt/live/console.migrateck.com/
   │  proxies http://10.10.0.10:3111/  (app-core internal LAN)
   ▼
app-core (100.101.3.99)
   │  systemd: migrateck.service
   │  EnvironmentFile: /etc/migrateck/console.env
   │  WorkingDirectory: /opt/migra/repos/migrateck/app/apps/web
   │  ExecStart: node node_modules/next/dist/bin/next start -p 3111
   ▼
Next.js 16 app (this code: apps/web/src/app/console/**)
   │
   ▼
Postgres on db-core (LAN 10.10.0.6:5432, Tailscale 100.77.51.91)
   │  database: migrapanel  (production source of truth, 180 tables)
   │  user/password: from MIGRAPANEL_DB_URL env var
```

### File map

```
apps/web/src/app/console/
├── COPILOT_HANDOFF.md   ← this file
├── STATUS.md            ← user-facing status (do not delete)
├── layout.tsx           ← bare layout (does NOT include marketing chrome)
├── page.tsx             ← overview dashboard (the screenshot the user shared)
├── login/page.tsx       ← login form
├── api/
│   ├── login/route.ts   ← POST validates creds, sets cookie
│   └── logout/route.ts  ← clears cookie
├── components/          ← UI primitives (DO NOT EDIT — Claude's territory)
│   ├── Sidebar.tsx, TopBar.tsx, KpiCard.tsx, EcosystemGrid.tsx,
│   ├── SystemMap.tsx, ActivityFeed.tsx, ServiceHealthPanel.tsx,
│   ├── RevenueChart.tsx, ClientsTable.tsx, SupportSlaPanel.tsx,
│   ├── SecurityCompliancePanel.tsx, TeamPerformance.tsx, QuickActions.tsx
└── lib/                 ← data loaders (THIS IS WHERE YOU WORK)
    ├── db.ts            ← Postgres pool singleton, panelQuery() helper
    ├── auth.ts          ← session/login helpers (don't touch unless adding RBAC)
    ├── kpis.ts          ← 6 KPI tiles
    ├── ecosystem.ts     ← 8 product control-grid tiles
    ├── health.ts        ← service health probes
    ├── activity.ts      ← unified activity feed
    ├── clients.ts       ← client accounts table
    ├── system-map.ts    ← orchestration map node counts
    ├── revenue.ts       ← revenue + billing chart
    ├── support.ts       ← support & SLA
    ├── security.ts      ← security & compliance
    └── team.ts          ← team performance table
```

### Rules of engagement

- **Never edit `components/*`** — that's Claude's UI work. Their props are stable contracts; if a panel needs new data, add the field to the corresponding `lib/*` loader, then update the `Component` props type if needed (coordinate via PR).
- **Never put hardcoded numbers in `lib/*`.** If a query returns zero rows or hits a missing table, return empty/zero — `panelQuery()` already swallows errors and returns `[]`. The UI shows honest empty states.
- **All loaders run server-side on every request** (`force-dynamic`). No caching layer yet — feel free to add `unstable_cache` if a panel becomes expensive.
- **TypeScript is strict.** `exactOptionalPropertyTypes` is on — never assign `undefined` to optional fields; either include the prop or omit it.
- **Lockfiles**: pnpm-lock.yaml + package-lock.json both exist. App runs in production using existing `node_modules` (no `npm ci` on deploy). Adding new deps requires rsyncing the new module dir to app-core.

---

## 2. Deployment process (verified, works)

```bash
# 1. Edit files locally under apps/web/src/app/console/
# 2. Typecheck (must pass)
cd /home/bonex/workspace/active/MigraTeck-Ecosystem/dev/MigraTeck/apps/web
npm run typecheck

# 3. Rsync src to app-core
rsync -az --delete \
  src/ \
  app-core:/opt/migra/repos/migrateck/app/apps/web/src/

# 4. Rebuild + restart on the server
ssh app-core "cd /opt/migra/repos/migrateck/app/apps/web && npm run build && systemctl restart migrateck"

# 5. Smoke test
curl -sI https://console.migrateck.com/console
```

If you add a new npm dep, also rsync `apps/web/node_modules/<new-dep>` (and any transitive deps it introduces).

---

## 3. Authentication (already wired — for reference)

- **Session cookie**: `migrateck_console_session`, HMAC-SHA256 signed with `CONSOLE_SESSION_SECRET`, 12-hour TTL, HttpOnly, Secure, SameSite=lax, path=`/console`
- **Login**: `POST /console/api/login` validates against `CONSOLE_ADMIN_EMAIL` + scrypt-hashed `CONSOLE_ADMIN_PASSWORD_HASH` (colon-separated format `scrypt:saltHex:hashHex` — NEVER use `$` separator, systemd's `EnvironmentFile` interprets `$` as variable expansion)
- **Gate**: every page in `/console/*` should call `getSession()` and `redirect("/console/login")` if no session. See `page.tsx` for the pattern
- **Multi-user**: currently single-admin only. To support multiple admins, replace the env-var check with a query against a new `console_admins` table (email + password_hash + role) and update `verifyEmail`/`verifyPassword` in `lib/auth.ts`

---

## 4. Per-panel wiring — current state + what to do

### KPI #1: Total Clients ✅ WIRED
- **Live value**: 28
- **Query**: `SELECT COUNT(*)::int FROM tenants`
- **File**: `lib/kpis.ts`
- **Status**: works, no changes needed

### KPI #2: Active Services ✅ WIRED
- **Live value**: 23
- **Query**: `SELECT COUNT(*)::int FROM subscriptions WHERE status IN ('active','trialing')`
- **File**: `lib/kpis.ts`

### KPI #3: Monthly Revenue ✅ WIRED
- **Live value**: $336
- **Query**: `SELECT SUM(total) FROM invoices WHERE status IN ('paid','captured','succeeded') AND createdat >= date_trunc('month', NOW())`
- **Note**: `invoices.total` is in dollars (numeric), NOT cents. Don't divide by 100.

### KPI #4: Open Tickets ⚠️ STUB
- **Live value**: 0 (query targets non-existent `support_tickets` table)
- **Fix**: change query in `lib/kpis.ts` to use `chat_tickets` instead. Schema lives in migrapanel.
  ```sql
  SELECT COUNT(*)::int FROM chat_tickets WHERE status NOT IN ('closed','resolved')
  ```
- **Verify column names**: `\d chat_tickets` on db-core — confirm `status` column exists, adjust filter values.

### KPI #5: Automation Runs ⚠️ STUB
- **Live value**: 0
- **Fix**: try `job_runs` first, fall back to `provisioning_runs`. Both tables exist.
  ```sql
  SELECT COUNT(*)::int FROM job_runs WHERE startedat >= date_trunc('month', NOW())
  ```
- **Verify** the timestamp column name (`startedat` vs `started_at` vs `createdat`).

### KPI #6: Platform Health ⚠️ STUB
- **Live value**: "Unknown"
- **Fix**: aggregate from `integration_health_checks` table (this is the real one — `module_health_status` was a guess that doesn't exist). Pattern:
  ```sql
  SELECT
    COUNT(*) FILTER (WHERE status='ok')::float / NULLIF(COUNT(*), 0) AS healthy_ratio
  FROM integration_health_checks
  WHERE createdat >= NOW() - INTERVAL '15 minutes'
  ```
- Result mapping: ≥0.95 → "Excellent", ≥0.85 → "Healthy", ≥0.7 → "Degraded", else "Critical".

### Ecosystem Control Grid (8 tiles, all showing 0% / Unknown) ⚠️ STUB
File: `lib/ecosystem.ts`. Per-tile fixes:

| Tile | Real source table | Suggested metric |
|---|---|---|
| MigraTeck | `users` + `failed_login_attempts` | % of last-7d auth successes |
| Hosting | `websites` + `website_status_rollups` | % of websites with status='ok' |
| MigraPanel | `audit_events` | events last 24h / trailing 7d avg (clamped 0-100) |
| Voice | `business_phone_extensions` + `business_phone_numbers` | % extensions registered now |
| Email | `mailboxes` + `mail_domains` | % of mailboxes with status='active' |
| Intake | `growth_leads` (NOT `intake_submissions`) + `builder_form_bindings` | submissions last 30d / max(forms*30, 1) |
| Marketing | `gbp_posts` + `gbp_provision_requests` | active GBP posts / total this quarter |
| Automation | `job_runs` (NOT `jobs`) | succeeded% over last 7 days |

For each, drop the bad query and replace with the new one. The existing pattern with `panelQuery<{pct: string}>(...)` is the contract — keep returning `pct` as a string-number.

### System Orchestration Map ⚠️ PARTIALLY WIRED
File: `lib/system-map.ts`. These fields are STUB:
- `hosting.active` → use `SELECT COUNT(*) FROM websites WHERE status='active'`
- `voice.lines` → use `SELECT COUNT(*) FROM business_phone_numbers`
- `intake.forms` → use `SELECT COUNT(*) FROM builder_form_bindings` (the `intake_forms` table doesn't exist)
- `automation.runs` → use `job_runs`
- `marketing.campaigns` → use `SELECT COUNT(*) FROM gbp_provision_requests WHERE status IN ('active','running','published')`

These ARE wired:
- `clients.active` (tenants) ✅
- `domains.total` (domains) ✅
- `email.mailboxes` (mailboxes) ✅
- `billing.mrrUsd` (subscriptions.original_rate + renewal_rate) ✅

### Activity Feed ⚠️ STUB (will work after schema check)
- Targets `audit_events` table, which DOES exist
- Schema: `id, tenantid, actortype, actoruserid, actionkey, resourcetype, resourceid, decision, reasoncode, ip, useragent, requestid, jobid, beforejson, afterjson, prevhash, hash, createdat`
- Query is in `lib/activity.ts` and looks right — TEST whether `audit_events` actually has rows. If empty in prod, this panel stays blank legitimately.
- If `audit_events` is empty but `audit_logs` (also exists) has rows, swap to that.

### Service Health & Uptime ✅ WIRED
- Uses live HTTP HEAD probes (no DB dependency) against the 8 public endpoints
- Optional enhancement: pull rolling 30d uptime from `integration_health_checks` aggregated by `target` or `service_name`

### Revenue Chart ⚠️ PARTIALLY WIRED
File: `lib/revenue.ts`. The big query is fine but the deltas are all 0. Fix: compute month-over-month delta against last month's totals.

### Clients Table ✅ WIRED (data is there but planTier is always "Free")
- Joins are fine
- The `planTier` column uses `subscriptions.pricing_model` which is `'introductory'` for most rows — not human-friendly
- Better: JOIN `subscriptions` → `subscription_items` → `plans` and surface `plans.name`. Schema: `\d plans` for details.

### Support & SLA ⚠️ STUB
File: `lib/support.ts`. Replace `support_tickets` → `chat_tickets` throughout. Verify column names:
- `assigneeid` may be `assignee_id` or under a different name
- `priority`, `status`, `createdat`, `firstresponseat` — check `\d chat_tickets`
- The `slamet` column may not exist — derive SLA compliance from comparing `firstresponseat - createdat` against `chat_sla_config.target_minutes`

### Security & Compliance ⚠️ STUB
File: `lib/security.ts`. Real tables:
- `auth_login_attempts` doesn't exist → use `failed_login_attempts` (real table)
- `backup_runs` doesn't exist → not in migrapanel; check if it's in another DB or skip this metric
- `firewall_status` doesn't exist → use `firewall_rules` (count `enabled=true`) or skip
- SSL: `domains.status` works for SSL coverage. Even better: `ssl_certificates` table — count active per total

Risk score formula in code is reasonable; just update the inputs.

### Team Performance ✅ WIRED (basic — active tasks always 0)
- Users are listed correctly (sarah.martinez, david.chen, james.taylor, lisa.morgan, etc.)
- `activeTasks` and `workloadPct` are hardcoded to 0 because `support_tickets` doesn't exist
- Fix: join `users` ↔ `chat_tickets` (assignee column) to count active tasks per user

### Quick Actions ✅ STATIC (correct as-is)
Just static links to per-module pages. Don't wire data here.

---

## 5. Module sub-pages to build

Each sidebar item should have a dedicated page at `/console/<module>/`. None exist yet — Claude built only the overview. **Build these next**, one per session, in this order of business value:

### Priority 1: `/console/clients/`
Full client list with filtering, search, drill-down to per-client view. Reuse `ClientsTable` component but expand. Per-client page at `/console/clients/[id]` showing:
- Subscriptions + invoices + payment methods (existing tables: `subscriptions`, `invoices`, `payments`, `payment_methods`)
- Domains owned (`domains` WHERE `tenantId`)
- Mailboxes (`mailboxes`)
- Hosting accounts (`websites`)
- Recent activity (`audit_events`)
- Support tickets (`chat_tickets`)
- Account manager + status + plan tier

### Priority 2: `/console/billing/`
- Invoices list (`invoices` + `invoice_items`)
- Payments (`payments`)
- Credit notes (`credit_notes`)
- Subscriptions (`subscriptions` + `subscription_items` + `plans`)
- Stripe sync status (if you find a stripe sync table) or pull from Stripe API with the `STRIPE_SECRET_KEY` already in console.env

### Priority 3: `/console/hosting/`
- Websites (`websites` + `website_status_rollups`)
- Builder sites (`builder_sites`, `builder_pages`)
- Deployments (`deployments`, `builder_deployments`)
- Provisioning queue (`provisioning_runs`, `provisioning_tasks`)

### Priority 4: `/console/email/`
- Domains (`mail_domains`)
- Mailboxes (`mailboxes`) + quotas
- Aliases (`mail_aliases`)
- DKIM/SPF status (cross-reference `dns_zones` on dns-core)

### Priority 5: `/console/voice/`
- Phone numbers (`business_phone_numbers`)
- Extensions (`business_phone_extensions`)
- IVRs (`business_phone_ivrs`)
- FreePBX resource map (`freepbx_resource_map`)
- Call assets (`business_phone_assets`)

### Priority 6: `/console/intake/`
- Form bindings (`builder_form_bindings`)
- Submissions / leads (`growth_leads`)
- Conversion goals (`builder_conversion_goals`)

### Priority 7: `/console/marketing/`
- GBP posts (`gbp_posts`), reviews (`gbp_reviews`), insights (`gbp_insights`)
- SEO audits (`seo_audits`, `seo_audit_runs`, `seo_page_snapshots`)

### Priority 8: `/console/automation/`
- Jobs (`jobs`) + runs (`job_runs`)
- Builder autonomy (`builder_autonomy_runs`, `builder_autonomy_actions`, `builder_autonomy_policies`)
- Provisioning (`provisioning_runs`, `provisioning_tasks`)
- Webhooks (`webhook_endpoints`, `webhook_deliveries`, `webhook_events`)

### Priority 9: `/console/support/`
- Tickets (`chat_tickets`)
- Conversations + messages (`chat_conversations`, `chat_messages`)
- Agent presence (`chat_agent_presence`)
- SLA config (`chat_sla_config`)
- Canned responses (`chat_canned_responses`)

### Priority 10: `/console/security/`
- Audit events (`audit_events`, `audit_logs`)
- Failed logins (`failed_login_attempts`)
- IP blocklist (`ip_blocklist`)
- Security incidents (`security_incidents`)
- Scan results (`security_scan_results`, `security_self_test_results`)
- Compliance (`compliance_audits`)
- Certificates (`certificates`, `ssl_certificates`, `ssl_alert_events`)
- WebAuthn (`webauthn_credentials`, `webauthn_challenges`)

### Priority 11: `/console/team/`
- Users (`users`)
- Memberships (`memberships`, `membership_constraints`)
- Roles (`roles`, `ac_roles`, `admin_roles`, `role_permissions`, `role_assignments`)
- HR data — large set of `hr_*` tables exist if you want to surface employee/payroll info

### Priority 12: `/console/analytics/`
- Builder analytics (`builder_analytics_events`, `builder_analytics_properties`)
- Activity events (`builder_activity_events`)
- Service events (`service_events`)
- Conversion goals (`builder_conversion_goals`)

### Priority 13: `/console/domains/`
- Domains (`domains`)
- DNS zones (`dns_zones`)
- DNS changesets (`dns_changesets`)
- DNS records (`dns_records_desired`)
- Transfers (`domain_transfer_requests`, `domain_transfers`)
- SSL policies (`tenant_ssl_policies`, `ssl_enforcement_events`)

### Priority 14: `/console/settings/`
- System configs (`system_control_configs`)
- Feature flags (`feature_flags`)
- Tenant entitlements (`tenant_entitlement_grants`, `tenant_entitlement_overrides`)
- Integration configs (`integration_configs`)

---

## 6. Schema discovery pattern

Before writing any query, check the actual column names:

```bash
ssh db-core "sudo -u postgres psql -d migrapanel -c '\\d <table_name>'"
```

Common gotchas in this DB:
- **Mixed snake_case and camelCase**: e.g. `domains.tenantId` is quoted camelCase; `subscriptions.tenantid` is lowercase. Both styles exist, sometimes side by side as duplicate columns (e.g. `tenants` has both `createdat` AND `createdAt`).
- **No `ssl_status` on `domains`** — use `status` column
- **No `displayname`** on users — use `display_name` or `first_name + last_name`
- **No `lastactiveat`** on users — use `last_login_at`
- **`audit_events`** is the real table, not `panel_audit_logs`
- **`chat_tickets`** is the real table, not `support_tickets`
- **`growth_leads`** for intake, not `intake_submissions`
- **`failed_login_attempts`** not `auth_login_attempts`
- **`builder_form_bindings`** not `intake_forms`
- **`websites`** is the hosting account table, not `hosting_accounts`

---

## 7. Full table list (180 tables — what's available)

Auth & access control:
`users`, `users_5_1_a2_bak`, `permissions`, `roles`, `role_permissions`, `role_assignments`, `ac_permissions`, `ac_roles`, `ac_role_permissions`, `ac_user_permission_grants`, `admin_roles`, `admin_role_permissions`, `memberships`, `membership_constraints`, `webauthn_credentials`, `webauthn_challenges`, `failed_login_attempts`, `break_glass_sessions`, `ip_blocklist`

Tenants & entitlements:
`tenants`, `customers`, `entitlements`, `tenant_entitlement_grants`, `tenant_entitlement_overrides`, `tenant_ip_allowlists`, `tenant_ssl_policies`

Billing:
`plans`, `plan_specs`, `products`, `subscriptions`, `subscription_items`, `invoices`, `invoice_items`, `payments`, `payment_methods`, `credit_notes`, `orders`, `order_items`

Hosting / websites / builder:
`websites`, `website_status_rollups`, `cloud_pods`, `builder_sites`, `builder_pages`, `builder_sections`, `builder_assets`, `builder_themes`, `builder_theme_token_sets`, `builder_global_blocks`, `builder_page_block_refs`, `builder_releases`, `builder_site_versions`, `builder_environments`, `builder_deployments`, `builder_comments`, `builder_comment_threads`, `builder_presence_sessions`, `builder_approvals`, `builder_activity_events`, `builder_analytics_events`, `builder_analytics_properties`, `builder_form_bindings`, `builder_conversion_goals`, `builder_experiments`, `builder_experiment_variants`, `builder_experiment_assignments`, `builder_optimization_insights`, `builder_optimization_runs`, `builder_optimization_suggestions`, `builder_autonomy_runs`, `builder_autonomy_actions`, `builder_autonomy_policies`, `builder_autonomy_recommendations`, `deployments`

DNS / domains:
`domains`, `domain_addons`, `domain_features`, `domain_forwarding`, `domain_security_configs`, `domain_ssl_policy_overrides`, `domain_transfers`, `domain_transfer_requests`, `domain_entitlement_grants`, `domain_entitlement_overrides`, `dns_zones`, `dns_changesets`, `dns_locks`, `dns_records_desired`

Email:
`mail_domains`, `mailboxes`, `mail_aliases`, `mail_users`, `email_templates`

Voice (FreePBX-backed):
`business_phone_numbers`, `business_phone_extensions`, `business_phone_ivrs`, `business_phone_assets`, `business_phone_runtime_approvals`, `business_phone_runtime_deployments`, `freepbx_resource_map`, `generated_voice_assets`

Marketing (Google Business Profile):
`gbp_posts`, `gbp_reviews`, `gbp_insights`, `gbp_photos`, `gbp_qna`, `gbp_activity_log`, `gbp_provision_requests`

SEO:
`seo_audits`, `seo_audit_runs`, `seo_page_snapshots`, `seo_internal_links`

Intake / leads:
`growth_leads` (use this), `builder_form_bindings`

Automation / jobs:
`jobs`, `job_runs`, `provisioning_runs`, `provisioning_tasks`, `migration_requests`, `migration_job_history`, `agents`, `service_events`, `service_instances`, `webhook_endpoints`, `webhook_deliveries`, `webhook_events`

Security & compliance:
`audit_events` (use this for events), `audit_logs`, `security_incidents`, `security_scan_results`, `security_self_test_results`, `compliance_audits`, `gdpr_deletion_requests`, `firewall_rules`, `certificates`, `ssl_certificates`, `ssl_alert_events`, `ssl_alert_policies`, `ssl_enforcement_events`, `cert_pinning_policies`, `approval_requests`, `approval_votes`

Support / chat:
`chat_tickets` (use this for tickets), `chat_ticket_messages`, `chat_conversations`, `chat_messages`, `chat_agent_presence`, `chat_business_hours`, `chat_canned_responses`, `chat_sla_config`, `chat_transfer_history`, `chat_usage_metering`, `chat_moderation_log`, `chat_abigail_sessions`

HR & payroll:
`hr_employees`, `hr_employee_profiles`, `hr_comp_history`, `hr_compensation_history`, `hr_direct_deposit`, `hr_documents`, `hr_goals`, `hr_leave_requests`, `hr_onboarding_tasks`, `hr_pay_deductions`, `hr_pay_runs`, `hr_pay_stubs`, `hr_payroll`, `hr_performance_reviews`, `hr_skills`, `hr_tax_withholding`, `hr_time_clock`

System / config / observability:
`system_control_configs`, `feature_flags`, `integration_configs`, `integration_events`, `integration_health_checks` (use this for platform health!), `integration_webhooks`, `report_definitions`, `report_runs`, `resources`, `resource_tags`

Cross-cutting:
`audit_events`, `audit_logs`, `email_templates`, `_prisma_migrations`

---

## 8. Environment variables on app-core

File: `/etc/migrateck/console.env` (mode 640, owner root:root)

```
MAIL_HOST_TAILSCALE=<from panel-api .env>
MAILCORE_API_TOKEN=<from panel-api .env>
MIGRAPANEL_DB_URL=postgresql://<user>:<pass>@10.10.0.6:5432/migrapanel
STRIPE_SECRET_KEY=<live Stripe key from panel-api .env>
CONSOLE_ADMIN_EMAIL=admin@migrateck.com
CONSOLE_ADMIN_PASSWORD_HASH=scrypt:<saltHex>:<hashHex>
CONSOLE_SESSION_SECRET=<≥24 random chars>
```

**Critical gotcha — systemd `EnvironmentFile=` interprets `$` as variable expansion.** Never use `$` in any env value here. The password hash uses `:` as separator for this reason. If you add new secrets that contain `$`, escape them as `$$`.

`migrateck.service` unit has `EnvironmentFile=/etc/migrateck/console.env`. After editing the env file, restart with `sudo systemctl restart migrateck`.

---

## 9. Existing bugs you might hit

1. **`X-Forwarded-Host` handling**: Next.js `req.url` reports the internal `0.0.0.0:3111`, not the public host. All redirects in API routes must use the helper:
   ```typescript
   const resolveBaseUrl = (req: NextRequest): string => {
     const fwdHost = req.headers.get("x-forwarded-host");
     const fwdProto = req.headers.get("x-forwarded-proto") ?? "https";
     if (fwdHost) return `${fwdProto}://${fwdHost}`;
     return process.env.APP_BASE_URL || new URL(req.url).origin;
   };
   ```
   See `api/login/route.ts` and `api/logout/route.ts` for the pattern.

2. **CSRF / form-action security**: Next.js 16 rejects POSTs without same-origin `Origin`/`Referer` headers. Browsers send these by default; curl doesn't. If you're testing API endpoints via curl, add `-H "Origin: https://console.migrateck.com" -H "Referer: https://console.migrateck.com/console/login"`.

3. **PublicChrome path inclusion**: any new sub-route under `/console/*` is already excluded from the marketing site's header/footer because `/console` is in the `INTERNAL_PREFIXES` list in `apps/web/src/components/layout/PublicChrome.tsx`. Don't remove it.

4. **`panelQuery()` swallows errors silently** (returns `[]`). This is intentional so a missing table doesn't crash the page. But it means typos in column names also return empty silently — verify queries against the live DB with `psql` before assuming the data isn't there.

---

## 10. Concrete first-day task list for you

1. SSH into db-core, run `\d` on each of these tables to confirm column names:
   `chat_tickets`, `job_runs`, `integration_health_checks`, `websites`, `business_phone_extensions`, `gbp_posts`, `growth_leads`, `failed_login_attempts`
2. Update `lib/kpis.ts` queries for Open Tickets, Automation Runs, Platform Health (Phase 1 above).
3. Update `lib/ecosystem.ts` queries to use real tables (Phase 1 above).
4. Update `lib/system-map.ts` for hosting/voice/intake/automation/marketing counts.
5. Replace `support_tickets` → `chat_tickets` in `lib/support.ts` and `lib/team.ts`.
6. Replace `auth_login_attempts` → `failed_login_attempts` in `lib/security.ts`. Drop the `backup_runs` and `firewall_status` queries (those tables don't exist; use empty defaults instead).
7. Deploy + visit `https://console.migrateck.com/console` — confirm all KPIs and tiles show real numbers.
8. Once overview is fully live, start on `/console/clients/` (Priority 1).

After steps 1-7, the overview page should look exactly like the user's mockup with NO "Unknown" or 0% anywhere — every value backed by a real production table.

---

## 11. UI contract (don't break)

Claude owns the look and feel. If you need to surface a new piece of data, add it to the relevant `lib/*` loader and propose the prop addition to the component (don't edit the component yourself). Keep:

- The dark slate-950 background, glass-morphism cards (`bg-white/[0.03] border-white/10 backdrop-blur`)
- Gradient accent colors (fuchsia/purple/pink) for primary CTAs
- Lucide icons (`lucide-react@1.8.0` — verify icon exists before using)
- Tailwind v4 utility classes only — no inline styles, no new CSS files
- Server components by default; client components only when needed for interactivity

That's it. Pick up from section 10 and ship.
