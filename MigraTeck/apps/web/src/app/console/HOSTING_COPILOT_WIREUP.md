# Copilot — Hosting module wire-up tasks

**8 capabilities are scaffolded in the UI but not data-wired.** Each one has a clear contract: which table to query (or create), which file to edit, what data shape the UI expects. Work them in any order. Stay inside `lib/modules/` and `lib/db.ts` — the page UI is locked.

**Live URL**: `https://console.migrateck.com/console/hosting/[id]` — open any site to see the "Coming soon" panel that lists these 8 items.

**Read first**: `COPILOT_HANDOFF.md` (v1, architecture + rules) and `COPILOT_HANDOFF_v2.md` (per-module priorities). This doc is hosting-specific.

---

## Universal pattern for each task below

1. Open `lib/modules/hosting-detail.ts`
2. Add a new field to the `WebsiteDetail` type
3. Add a new query inside the `Promise.all` in `loadWebsiteDetail`
4. Map snake_case → camelCase in the return object (mandatory — `exactOptionalPropertyTypes` rejects direct casts)
5. Tell me (Claude) the field name and shape, I'll add the panel to `hosting/[id]/page.tsx`

If a table doesn't exist yet, create it via a Prisma migration in the migrapanel repo, then wire here. Don't fake data.

---

## 1. Live resource metrics

**What the UI needs**: 4-number metrics tile (Disk used GB, Bandwidth GB/mo, CPU avg %, Request rate req/s).

**Backend gap**: No metrics agent on cloud-core writing to a database. The right path is a Prometheus scrape + a rollup job that materializes daily averages into a Postgres table.

**Recommended table** (create if missing):
```sql
CREATE TABLE website_metrics_rollup (
  website_id TEXT PRIMARY KEY REFERENCES websites(id) ON DELETE CASCADE,
  disk_used_mb BIGINT DEFAULT 0,
  bandwidth_mb_month BIGINT DEFAULT 0,
  cpu_avg_pct NUMERIC(5,2) DEFAULT 0,
  request_rate_per_sec NUMERIC(8,2) DEFAULT 0,
  last_collected_at TIMESTAMPTZ
);
```

**Type addition** (`hosting-detail.ts`):
```typescript
metrics: {
  diskUsedMb: number;
  bandwidthMbMonth: number;
  cpuAvgPct: number;
  requestRatePerSec: number;
  lastCollectedAt: string | null;
} | null;  // null until first collection
```

**Query**:
```typescript
panelQuery<{ disk_used_mb: string; bandwidth_mb_month: string; cpu_avg_pct: string; request_rate_per_sec: string; last_collected_at: string | null }>(
  `SELECT disk_used_mb::text, bandwidth_mb_month::text, cpu_avg_pct::text, request_rate_per_sec::text, last_collected_at::text
     FROM website_metrics_rollup WHERE website_id = $1`,
  [id],
)
```

**Definition of done**: `WebsiteDetail.metrics` populated for at least one site. If the agent isn't deployed yet, return `null` and the UI shows "Metrics agent not yet reporting."

---

## 2. PHP / Node runtime version selector

**What the UI needs**: Current runtime + version, plus a dropdown to change it (queues `runtime.upgrade` provisioning task).

**Backend gap**: `websites.runtime` column exists (e.g. "node-20", "php-8.2") but there's no version registry.

**Recommended approach**: Use the existing `websites.runtime` field as source of truth. No new table needed.

**Type addition**:
```typescript
runtime: {
  current: string | null;      // websites.runtime
  available: ReadonlyArray<string>;  // hardcode or pull from a runtimes table
};
```

**Available runtimes** (hardcode in lib for now):
```typescript
const AVAILABLE_RUNTIMES = [
  "node-18", "node-20", "node-22",
  "php-7.4", "php-8.0", "php-8.1", "php-8.2", "php-8.3",
  "python-3.10", "python-3.11", "python-3.12",
  "static", "wordpress",
];
```

**Mutator** — add to `hosting/[id]/page.tsx`:
```typescript
async function changeRuntime(formData: FormData) {
  "use server";
  const id = String(formData.get("id") || "");
  const runtime = String(formData.get("runtime") || "");
  if (!id || !runtime) return;
  await panelExec(
    `INSERT INTO provisioning_tasks (id, "tenantId", "serviceInstanceId", type, status, "idempotencyKey", "createdAt")
     VALUES ($1, $2, $3, 'runtime.upgrade', 'queued', $4, NOW())`,
    [randomUUID(), tenantId, id, randomUUID()],
  );
  // Optimistically update for UI feedback
  await panelExec(`UPDATE websites SET runtime = $2 WHERE id = $1`, [id, runtime]);
  revalidatePath(`/console/hosting/${id}`);
}
```

**Definition of done**: Site detail shows current runtime, dropdown changes it, provisioning task queued for the worker.

---

## 3. Environment variables editor

**What the UI needs**: List of KEY=VALUE pairs for the site, with add/edit/delete actions. Values are secret-by-default (show ••• until clicked).

**Backend gap**: No `site_env_vars` table.

**Create table**:
```sql
CREATE TABLE site_env_vars (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "websiteId" TEXT NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  is_secret BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE ("websiteId", key)
);
```

**Type addition**:
```typescript
envVars: ReadonlyArray<{
  id: string;
  key: string;
  value: string;    // already redacted if isSecret — return "••••••••" for these
  isSecret: boolean;
  updatedAt: string | null;
}>;
```

**Query** (always redact secrets at the lib boundary):
```typescript
panelQuery<{ id: string; key: string; value: string; is_secret: boolean; updated_at: string | null }>(
  `SELECT id, key,
          CASE WHEN is_secret THEN '••••••••' ELSE value END AS value,
          is_secret, updated_at::text AS updated_at
     FROM site_env_vars WHERE "websiteId" = $1 ORDER BY key ASC`,
  [id],
)
```

**Mutators** (add/edit/delete) go in `hosting/[id]/page.tsx`. The "view" action that reveals a secret needs a separate route that pulls the raw value — `/console/hosting/[id]/env/[envId]/reveal`. Server action returns the plaintext to the client briefly.

**Provisioning hook**: After any env-var change, queue a `runtime.restart` provisioning task so the change takes effect.

**Definition of done**: Table exists, CRUD works, secrets are redacted on list, runtime restart is queued on change.

---

## 4. Cron jobs management

**What the UI needs**: Per-site list of cron jobs with schedule, command, last run, next run, status. Add/edit/delete + run-now button.

**Backend gap**: `jobs` table exists but is global/tenant-scoped, not website-scoped. Per-site crons need linkage.

**Schema change**: Add `"websiteId"` column to `jobs`:
```sql
ALTER TABLE jobs ADD COLUMN "websiteId" TEXT REFERENCES websites(id) ON DELETE CASCADE;
CREATE INDEX jobs_website_id_idx ON jobs("websiteId");
```

**Type addition**:
```typescript
cronJobs: ReadonlyArray<{
  id: string;
  name: string;
  schedule: string | null;  // cron expression
  command: string | null;
  status: string;
  lastRunAt: string | null;
  nextRunAt: string | null;  // compute from cron + clock OR pull from a job_runs row
}>;
```

**Query**:
```typescript
panelQuery<{ id: string; name: string; schedule: string | null; status: string; lastrunat: string | null }>(
  `SELECT j.id, j.name, j.schedule, COALESCE(j.status, 'active') AS status,
          (SELECT MAX("startedAt")::text FROM job_runs WHERE jobid = j.id) AS lastrunat
     FROM jobs j WHERE j."websiteId" = $1 ORDER BY j.name ASC`,
  [id],
)
```

**Mutator — run now**:
```typescript
async function runJobNow(formData: FormData) {
  "use server";
  const jobId = String(formData.get("jobId") || "");
  await panelExec(
    `INSERT INTO job_runs (id, jobid, status, "startedAt") VALUES ($1, $2, 'pending', NOW())`,
    [randomUUID(), jobId],
  );
  // The job runner worker picks this up
}
```

**Definition of done**: `jobs.websiteId` column added, per-site crons list works, run-now creates a `job_runs` row that the runner picks up.

---

## 5. File manager / SFTP credentials

**What the UI needs**: SFTP host + port + username + key fingerprint shown in a card. "Reset password" button + "Download SSH key" button. Optional embedded file manager — defer that.

**Backend gap**: No `sftp_accounts` table. Cloud-core probably has SFTP set up per-website but no panel-side record.

**Create table**:
```sql
CREATE TABLE sftp_accounts (
  "websiteId" TEXT PRIMARY KEY REFERENCES websites(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE,
  host TEXT NOT NULL DEFAULT 'sftp.migrahosting.com',
  port INTEGER NOT NULL DEFAULT 22,
  home_path TEXT NOT NULL,
  public_key_fingerprint TEXT,
  last_password_reset_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Type addition**:
```typescript
sftp: {
  username: string;
  host: string;
  port: number;
  homePath: string;
  publicKeyFingerprint: string | null;
  lastPasswordResetAt: string | null;
} | null;  // null if not provisioned
```

**Reset password** queues a `sftp.password.reset` provisioning task. The worker generates a strong password, sets it on the SFTP server, and returns the plaintext ONCE through a `sftp_password_reveals` table (one-time read, deleted after view).

**Definition of done**: SFTP info displays when present; reset queues the task; reveal-once flow works.

---

## 6. Database manager (link to phpMyAdmin)

**What the UI needs**: List of databases on this site (name, type postgres/mysql, user count, size), with a "Open phpMyAdmin" button per row.

**Backend gap**: No `site_databases` table. Cloud-core may have databases per site (depending on the runtime) but no panel-side record.

**Create table**:
```sql
CREATE TABLE site_databases (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "websiteId" TEXT NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  db_type TEXT NOT NULL CHECK (db_type IN ('postgres','mysql','sqlite','mongodb')),
  host TEXT,
  port INTEGER,
  username TEXT,
  password_hash TEXT,            -- scrypt-hashed, like CONSOLE_ADMIN_PASSWORD_HASH
  size_mb BIGINT DEFAULT 0,
  phpmyadmin_url TEXT,           -- pre-built signed URL or path to redirector
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Type addition**:
```typescript
databases: ReadonlyArray<{
  id: string;
  name: string;
  dbType: string;
  host: string | null;
  port: number | null;
  sizeMb: number;
  phpmyadminUrl: string | null;
}>;
```

**Definition of done**: Per-site DB list renders; "Open phpMyAdmin" link works (or the row shows "phpMyAdmin not provisioned for this DB" if URL missing).

---

## 7. Backup snapshots + restore points

**What the UI needs**: List of backups (timestamp, size, type, retention age). Per-row "Restore to this point" + "Download" buttons. The existing "Run backup now" button in the Operations toolbar already queues a `hosting.backup` provisioning task — once a backup worker runs, it should write to a `backup_runs` table.

**Backend gap**: No `backup_runs` table.

**Create table**:
```sql
CREATE TABLE backup_runs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "websiteId" TEXT NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  "tenantId" TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('full','incremental','snapshot')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','success','failed','expired')),
  size_bytes BIGINT,
  storage_url TEXT,                -- s3://migra-backups/site-id/backup-id.tar.zst
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  triggered_by_task_id TEXT REFERENCES provisioning_tasks(id),
  triggered_by_user_id TEXT REFERENCES users(id),
  error TEXT
);
CREATE INDEX backup_runs_website_idx ON backup_runs("websiteId", started_at DESC);
```

**Type addition**:
```typescript
backups: ReadonlyArray<{
  id: string;
  kind: string;
  status: string;
  sizeBytes: number;
  startedAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
}>;
```

**Restore mutator**:
```typescript
async function restoreBackup(formData: FormData) {
  "use server";
  const websiteId = String(formData.get("websiteId") || "");
  const backupId = String(formData.get("backupId") || "");
  await panelExec(
    `INSERT INTO provisioning_tasks (id, "tenantId", "serviceInstanceId", type, status, "idempotencyKey", "createdAt", "payloadJson")
     VALUES ($1, $2, $3, 'hosting.restore', 'queued', $4, NOW(), $5::jsonb)`,
    [randomUUID(), tenantId, websiteId, randomUUID(), JSON.stringify({ backupId })],
  );
}
```

**Definition of done**: Backup table exists, list renders past backups, restore queues a task, "Run backup now" button (already wired) creates a corresponding `backup_runs` row when the worker completes.

---

## 8. Activity timeline (per-site)

**What the UI needs**: Last 30 events tied to this website — deploys, SSL renewals, status changes, env var edits, etc. Each entry: timestamp, actor, action description, link to related entity.

**Backend gap**: `audit_events` table exists and is populated, but events are typically scoped by `tenantid` + `resourcetype` + `resourceid`. Filter for `resourcetype = 'website' AND resourceid = $id`.

**Type addition**:
```typescript
activity: ReadonlyArray<{
  id: string;
  actionKey: string;       // e.g. "website.status.changed"
  actorEmail: string | null;
  decision: string;        // allow|deny
  createdAt: string;
  beforeJson: unknown;     // for diff rendering
  afterJson: unknown;
}>;
```

**Query**:
```typescript
panelQuery<{ id: string; actionkey: string; actoremail: string | null; decision: string; createdat: string; beforejson: unknown; afterjson: unknown }>(
  `SELECT a.id, a.actionkey, u.email AS actoremail, a.decision,
          a.createdat::text AS createdat, a.beforejson, a.afterjson
     FROM audit_events a
     LEFT JOIN users u ON u.id = a.actoruserid
    WHERE a.resourcetype = 'website' AND a.resourceid = $1
    ORDER BY a.createdat DESC
    LIMIT 30`,
  [id],
)
```

**Note**: For audit events to populate, all of the existing mutators in `hosting/[id]/page.tsx` need to write to `audit_events` after each change. Add a helper:
```typescript
// in lib/audit.ts
export async function auditLog(opts: {
  tenantId: string;
  actorUserId: string | null;
  actionKey: string;       // e.g. "website.status.changed"
  resourceType: string;    // e.g. "website"
  resourceId: string;
  decision: "allow" | "deny";
  beforeJson?: object;
  afterJson?: object;
}) {
  await panelExec(
    `INSERT INTO audit_events (id, tenantid, actortype, actoruserid, actionkey, resourcetype, resourceid, decision, createdat, beforejson, afterjson)
     VALUES ($1, $2, 'user', $3, $4, $5, $6, $7, NOW(), $8::jsonb, $9::jsonb)`,
    [
      randomUUID(),
      opts.tenantId,
      opts.actorUserId,
      opts.actionKey,
      opts.resourceType,
      opts.resourceId,
      opts.decision,
      JSON.stringify(opts.beforeJson ?? {}),
      JSON.stringify(opts.afterJson ?? {}),
    ],
  );
}
```

Then call `auditLog(...)` inside each of the 5 existing server actions (`pauseSite`, `resumeSite`, `forceSslRenew`, `triggerDeploy`, `triggerBackup`). The actor user id is the admin's email — need to pass the session through. The simplest path: add a thin wrapper that combines `getSession()` + `auditLog()`.

**Definition of done**: 30-day activity timeline renders below SSL/DNS sections; every mutator writes an audit event; admin signature appears next to each event.

---

## After all 8 are wired — tell Claude (me)

When each gap is filled in `lib/modules/hosting-detail.ts`, ping Claude with:
- The field name added to `WebsiteDetail`
- The shape of the data (with a sample row)

Claude will then add the panel UI to `hosting/[id]/page.tsx` and move the item out of the "Coming soon" card into a real section. Don't touch the page file yourself — that's Claude's territory.

---

## Order of impact (work top-down)

1. **Backup snapshots** (#7) — admins need this NOW for safety; the worker is the dependency, not the UI
2. **Activity timeline** (#8) — high transparency value, depends only on existing `audit_events` table
3. **Cron jobs** (#4) — just an ALTER TABLE on the existing `jobs` table
4. **Env vars** (#3) — new table, but pure CRUD, no external dependencies
5. **Runtime version** (#2) — uses existing `websites.runtime` column, simplest UX impact
6. **SFTP** (#5) — needs a worker integration with the SFTP server
7. **Database manager** (#6) — needs phpMyAdmin URL signing or proxy
8. **Live metrics** (#1) — needs a metrics agent deployed on cloud-core; deepest dependency

Items 1-5 are quick wins, items 6-8 require infrastructure work.

---

## Hard boundaries (don't break)

- Don't edit `hosting/[id]/page.tsx`, `hosting/page.tsx`, or anything in `components/` — Claude's UI work
- Don't add new npm dependencies — `pg` is already there
- Don't change the auth flow
- Don't `as Type[]` cast — always explicit field mapping (see v2 handoff for the pattern)
- Test each fix with: `npm run typecheck` → rsync → restart migrateck → curl with session cookie
