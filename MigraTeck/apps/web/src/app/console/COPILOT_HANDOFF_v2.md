# Copilot Handoff v2 — Module Pages Are Built, Time to Wire Them

**Read `COPILOT_HANDOFF.md` first.** This v2 only covers what changed and what's next.

---

## What changed since v1

**Status before v1**: only the overview page (`/console`) existed; every sidebar link 404'd.
**Status now**: all 15 module pages + clients drill-down are built and returning HTTP 200. The UI shells are in place, queries are in place, **but several queries assume column names we haven't verified against the real schema** — they target the right table but may need column-name corrections (snake_case vs camelCase, lowercase vs quoted, etc.).

If a query is wrong, the page still renders — it just shows an empty state. Your job: open each `lib/modules/<name>.ts`, verify the SQL against the live schema with `\d <table>`, fix mismatches.

### New file structure (the part that matters for you)

```
apps/web/src/app/console/
├── components/
│   ├── ConsolePageShell.tsx    ← every module wraps in this (auth + sidebar + topbar + header). DO NOT EDIT.
│   ├── DataTable.tsx + StatusPill ← generic table. DO NOT EDIT.
│   ├── SectionCard.tsx, EmptyState.tsx ← layout primitives. DO NOT EDIT.
│   └── (existing overview components from v1)
├── lib/
│   ├── modules/                 ← ALL YOUR WORK GOES HERE
│   │   ├── clients.ts           ← list + detail loaders
│   │   ├── billing.ts           ← invoices, payments, subscriptions
│   │   ├── hosting.ts           ← websites, deployments, provisioning
│   │   ├── email.ts             ← mail_domains, mailboxes, aliases
│   │   ├── voice.ts             ← business_phone_*
│   │   ├── intake.ts            ← growth_leads, form_bindings
│   │   ├── marketing.ts         ← gbp_*, seo_*
│   │   ├── automation.ts        ← jobs, job_runs, webhooks
│   │   ├── support.ts           ← chat_tickets, agents
│   │   ├── security.ts          ← audit_events, failed_login_attempts, incidents, certs
│   │   ├── team.ts              ← users, roles
│   │   ├── analytics.ts         ← analytics events, conversion goals
│   │   ├── domains.ts           ← domains, dns_zones, transfers
│   │   └── settings.ts          ← feature_flags, entitlements, system_control_configs
│   └── (existing v1 loaders: kpis, ecosystem, health, etc.)
├── clients/page.tsx + clients/[id]/page.tsx
├── billing/page.tsx
├── hosting/page.tsx
├── email/page.tsx
├── voice/page.tsx
├── intake/page.tsx
├── marketing/page.tsx
├── automation/page.tsx
├── support/page.tsx
├── security/page.tsx
├── team/page.tsx
├── analytics/page.tsx
├── domains/page.tsx
└── settings/page.tsx
```

**You will not need to edit any page.tsx file or any component file.** Your only edits are to `lib/modules/*.ts` and the existing `lib/*.ts` loaders from v1 (kpis, ecosystem, system-map, etc.).

---

## Critical patterns to follow

### 1. Always map snake_case → camelCase explicitly

Postgres returns lowercase column names (or quoted camelCase). TypeScript types use camelCase. **Never `as Type[]` cast** — TypeScript with `exactOptionalPropertyTypes` will catch the mismatch and the build fails. Instead:

```typescript
// ❌ BAD — type errors out
const rows = await panelQuery<{ id: string; createdat: string | null }>(`...`);
return rows as SomeType[];

// ✅ GOOD — explicit field mapping
const rows = await panelQuery<{ id: string; createdat: string | null }>(`...`);
return rows.map((r) => ({ id: r.id, createdAt: r.createdat }));
```

Every `lib/modules/*.ts` file already follows this. If you add fields, follow the same pattern.

### 2. `panelQuery()` swallows errors silently

If a query references a table or column that doesn't exist, it returns `[]` and logs to console. The page keeps rendering with empty state. **This means typos in column names won't crash the page** — they'll just show empty. Verify queries with `psql` before assuming the table is empty.

### 3. Use `force-dynamic`, run server-side, fetch in parallel

Every page already has `export const dynamic = "force-dynamic"`. The loaders use `Promise.all` for parallelization. Keep this pattern.

### 4. Page action buttons must use plain `<button>` or `<Link>` — no client components

Server components only. If you genuinely need interactivity (delete buttons, form submissions), add a Server Action — don't convert the page to client.

---

## Per-module task list — what to verify and fix

For each module, run the schema check first, then patch the query if needed.

### `lib/modules/clients.ts`
**Used by**: `/console/clients` (list) + `/console/clients/[id]` (detail)
**Status**: list query works (uses `tenants` + `subscriptions` joins). Detail query joins multiple tables.
**Schema checks**:
```sql
\d websites    -- confirm tenantid vs "tenantId" (camelCase quoted) for the websites query at line ~110
\d mailboxes   -- confirm tenantid (lowercase) — already verified in v1
\d invoices    -- confirm tenantid + createdat naming
```
**Likely fix**: `websites.tenantid` is probably lowercase per Prisma migration patterns. If quoted camelCase, change to `"tenantId"`.

### `lib/modules/billing.ts`
**Used by**: `/console/billing`
**Tables**: `invoices`, `payments`, `subscriptions`
**Schema checks**:
```sql
\d payments        -- verify amount column, status column, tenantid column
\d invoices        -- already verified: total (numeric, dollars), status, dueat, createdat
\d subscriptions   -- verified: original_rate, renewal_rate, pricing_model
```
**Likely fix**: `payments.amount` might be `amount_cents` or `total` instead. Adjust accordingly.

### `lib/modules/hosting.ts`
**Used by**: `/console/hosting`
**Tables**: `websites`, `deployments`, `provisioning_tasks`
**Schema checks**:
```sql
\d websites              -- confirm domain, status, tenantid, updatedat columns
\d deployments           -- confirm status, websiteid, createdat
\d provisioning_tasks    -- confirm type, status, createdat
```

### `lib/modules/email.ts`
**Used by**: `/console/email`
**Tables**: `mail_domains`, `mailboxes`, `mail_aliases`
**Schema checks**:
```sql
\d mail_aliases   -- verify source_local, destination, is_active, createdat
```
**Already verified in v1**: `mailboxes` (address, status, tenantid, createdat), `mail_domains` (domain, tenantid, status, createdat).

### `lib/modules/voice.ts`
**Used by**: `/console/voice`
**Tables**: `business_phone_numbers`, `business_phone_extensions`, `business_phone_ivrs`
**Schema checks**:
```sql
\d business_phone_numbers     -- verify "number" column name + tenantid + status + createdat
\d business_phone_extensions  -- verify extension, display_name, enabled, createdat
\d business_phone_ivrs        -- verify name, status
```
**Common gotcha**: `number` is a SQL keyword in some dialects — may be `phone_number` or `"number"`. Check.

### `lib/modules/intake.ts`
**Used by**: `/console/intake`
**Tables**: `growth_leads`, `builder_form_bindings`
**Schema checks**:
```sql
\d growth_leads            -- verify name vs full_name, email, status, source, createdat
\d builder_form_bindings   -- verify form_key (or name?), status, createdat
```
**Likely fix**: `form_binding_id` link from `growth_leads` to `builder_form_bindings` may not exist; check FK columns.

### `lib/modules/marketing.ts`
**Used by**: `/console/marketing`
**Tables**: `gbp_posts`, `gbp_reviews`, `seo_audit_runs`
**Schema checks**:
```sql
\d gbp_posts        -- verify title, status, tenantid, createdat
\d gbp_reviews      -- verify rating (numeric), comment, tenantid, createdat
\d seo_audit_runs   -- verify score, status, run_at, target_url
```

### `lib/modules/automation.ts`
**Used by**: `/console/automation`
**Tables**: `jobs`, `job_runs`, `webhook_endpoints`, `webhook_deliveries`
**Schema checks**:
```sql
\d jobs                -- verify name, type, status, createdat
\d job_runs            -- already verified: "startedAt" is quoted camelCase, jobid lowercase
\d webhook_endpoints   -- verify url, status, createdat
\d webhook_deliveries  -- verify endpointid, createdat
```
**Already known**: `job_runs."startedAt"` needs camelCase quoted; `jr.jobid` is lowercase. Inconsistent quoting in same table is common in this DB.

### `lib/modules/support.ts`
**Used by**: `/console/support`
**Tables**: `chat_tickets`, `users` (for assignees)
**Schema checks**:
```sql
\d chat_tickets   -- verify subject, status, priority, tenantid, assigned_to, created_at
```
**Already adjusted from v1**: column is `assigned_to` (snake_case) and `created_at` (with underscore), not `assigneeid` and `createdat`. Double-check by running the live query.

### `lib/modules/security.ts`
**Used by**: `/console/security`
**Tables**: `audit_events`, `failed_login_attempts`, `security_incidents`, `certificates`
**Schema checks**:
```sql
\d failed_login_attempts  -- verify email, ip, reason, createdat
\d security_incidents     -- verify severity, status, title, createdat
\d certificates           -- verify domain, issuer, expiresat, status
```
**Already verified**: `audit_events` schema.

### `lib/modules/team.ts`
**Used by**: `/console/team`
**Tables**: `users`, `roles`
**Schema checks**:
```sql
\d roles   -- verify name, description (description may be optional → already coerced to nullable in TS type)
```
**Already verified**: `users` (display_name, first_name, last_name, email, role, is_active, last_login_at, createdat). Same as v1.

### `lib/modules/analytics.ts`
**Used by**: `/console/analytics`
**Tables**: `builder_analytics_events`, `builder_conversion_goals`, `service_events`
**Schema checks**:
```sql
\d builder_analytics_events   -- verify event_type, site_id, createdat
\d builder_conversion_goals   -- verify name, event_key (or different name?), createdat
\d service_events             -- verify kind, status, createdat
```

### `lib/modules/domains.ts`
**Used by**: `/console/domains`
**Tables**: `domains`, `dns_zones`, `domain_transfer_requests`
**Schema checks**:
```sql
\d domains                    -- already verified: "tenantId" quoted camelCase, "createdAt" quoted, status, role, expiresat
\d dns_zones                  -- verify "name" or "zone" column, status
\d domain_transfer_requests   -- verify domainid, status, createdat
```

### `lib/modules/settings.ts`
**Used by**: `/console/settings`
**Tables**: `feature_flags`, `tenant_entitlement_grants`, `system_control_configs`
**Schema checks**:
```sql
\d feature_flags                 -- verify key, enabled (boolean), description
\d tenant_entitlement_grants     -- verify entitlement_key vs entitlementid, status, createdat
\d system_control_configs        -- verify key, value, createdat
```
**Note**: `system_control_configs.value` is likely JSONB. The query uses `value::text` to coerce — verify this doesn't break.

---

## Things still showing "Unknown" / 0 on `/console` overview

Per v1's mappings, these still need work in the EXISTING loaders (not new module loaders):

1. **Platform Health** (KPI tile): query in `lib/kpis.ts` targets `integration_health_checks` — verify `checked_at` and `status` column names. If they're `created_at` and the status values are different (e.g., `healthy` vs `ok`), adjust.

2. **MigraTeck Core** ecosystem tile (showing "Unknown"): in `lib/ecosystem.ts`, the first query uses `users.last_login_at` and `users.is_active`. If less than 1 active user logged in last 7 days, tile shows 0%. If all users are inactive, status stays Unknown. **Verify with**: `SELECT COUNT(*) FROM users WHERE last_login_at >= NOW() - INTERVAL '7 days'`.

3. **MigraPanel** tile: query against `audit_events`. If audit_events is sparse or empty in production, tile shows 0%.

4. **Marketing** tile: query against `gbp_posts` filtered to this quarter. May be sparse.

---

## Verification protocol after each fix

After patching a query, run:

```bash
# 1. Typecheck (must pass)
cd /home/bonex/workspace/active/MigraTeck-Ecosystem/dev/MigraTeck/apps/web && npm run typecheck

# 2. Deploy (rsync just src/, server has node_modules)
rsync -az --delete src/ app-core:/opt/migra/repos/migrateck/app/apps/web/src/

# 3. Rebuild + restart
ssh app-core "cd /opt/migra/repos/migrateck/app/apps/web && npm run build && systemctl restart migrateck"

# 4. Smoke test (must return 200, not 500)
curl -sI -b cookies.txt https://console.migrateck.com/console/<module>
```

If the build fails after your fix, common causes:
- Forgot to map snake_case → camelCase (returns `as Type[]` directly)
- Forgot `as const` on a `direction: "up"` field
- Added a new optional field but didn't include `| undefined` in the type

---

## Authentication for testing your changes

Login URL: `https://console.migrateck.com/console/login`
Email: `admin@migrateck.com`
Password: the value of `CONSOLE_ADMIN_PASSWORD_HASH` env var on app-core (ask the user; password is `fuETv5t5Yq1nqIF2E5ZG` unless rotated).

To curl-test with a session:
```bash
curl -s -X POST -d "email=admin@migrateck.com&password=PASS" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Origin: https://console.migrateck.com" \
  -H "Referer: https://console.migrateck.com/console/login" \
  -c /tmp/c.txt https://console.migrateck.com/console/api/login
curl -sb /tmp/c.txt https://console.migrateck.com/console/clients | head
```

---

## UI contract (unchanged from v1)

- Don't edit `apps/web/src/app/console/components/*` — that's Claude
- Don't edit any `page.tsx` file — that's Claude
- DO edit `lib/modules/*.ts` and `lib/*.ts` loaders — that's you
- If a new metric requires a new prop on a component, propose it with the SQL you'd run and Claude will add the prop to the component, then you can wire the loader to populate it

---

## Priority order for fixes

The user uses these modules most. Fix in this order:

1. **`lib/modules/billing.ts`** — `payments.amount` schema check (top metrics depend on this)
2. **`lib/modules/clients.ts`** — verify `websites.tenantid` quoting (the per-client drill-down needs this)
3. **`lib/modules/support.ts`** — verify chat_tickets schema (Open Tickets KPI feeds from here too)
4. **`lib/kpis.ts`** — Platform Health "Unknown" → fix `integration_health_checks` query
5. **`lib/ecosystem.ts`** — MigraTeck Core / MigraPanel / Marketing tiles showing 0%
6. Everything else (hosting, email, voice, intake, marketing, automation, security, team, analytics, domains, settings) — fix in any order

After all fixes, the overview should show no "Unknown" or 0% values, and every module page should display real production data.

---

## What you DON'T need to build

Per the user's split:
- ❌ No new UI components — use what's there
- ❌ No new pages — use what's there
- ❌ No CSS / Tailwind classes — leave styling alone
- ❌ No client components — server-only
- ❌ No new dependencies — `pg` is already installed

If you find yourself wanting to do any of these, stop and tell the user — Claude will handle it.

---

## TL;DR

1. Read `COPILOT_HANDOFF.md` (v1) for architecture, deployment process, auth, and gotchas
2. Open `lib/modules/billing.ts`, verify `payments` schema, fix any mismatches
3. Typecheck, deploy, smoke
4. Move to next module in the priority order above
5. The dashboard will fill in from "Unknown" / 0 to real numbers as you go
