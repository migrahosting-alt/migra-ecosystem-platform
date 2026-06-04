import { AVAILABLE_HOSTING_RUNTIMES } from "./hosting-actions";
import { panelQuery, isPanelDbConfigured } from "../db";

export type WebsiteDetail = {
  id: string;
  domain: string | null;
  status: string;
  tenantId: string | null;
  tenantName: string | null;
  hostingType: string | null;
  runtime: string | null;
  runtimeControl: {
    current: string | null;
    available: ReadonlyArray<string>;
  };
  createdAt: string | null;
  updatedAt: string | null;
  // Lifecycle metrics
  lastDeployAt: string | null;
  lastDeployStatus: string | null;
  deployCount30d: number;
  // SSL
  ssl: {
    activeCount: number;
    expiringSoon: ReadonlyArray<{
      id: string;
      domainName: string | null;
      expiresAt: string | null;
      provider: string | null;
      status: string;
      autoRenew: boolean;
    }>;
  };
  // Recent deployments (tenant-scoped — no per-website FK exists)
  deployments: ReadonlyArray<{
    id: string;
    name: string;
    type: string;
    status: string;
    createdAt: string | null;
    completedAt: string | null;
  }>;
  // Provisioning tasks (in-flight)
  provisioningTasks: ReadonlyArray<{
    id: string;
    type: string | null;
    status: string;
    createdAt: string | null;
  }>;
  // Aliases / related domains
  domains: ReadonlyArray<{ id: string; domain: string; role: string; status: string }>;
  // Live resource metrics
  metrics: {
    diskUsedMb: number;
    bandwidthMbMonth: number;
    cpuAvgPct: number;
    requestRatePerSec: number;
    lastCollectedAt: string | null;
  } | null;
  // Per-site environment variables
  envVars: ReadonlyArray<{
    id: string;
    key: string;
    value: string;
    isSecret: boolean;
    updatedAt: string | null;
  }>;
  // Per-site cron jobs
  cronJobs: ReadonlyArray<{
    id: string;
    name: string;
    schedule: string | null;
    command: string | null;
    status: string;
    lastRunAt: string | null;
    nextRunAt: string | null;
  }>;
  // SFTP credentials / connection info
  sftp: {
    username: string;
    host: string;
    port: number;
    homePath: string;
    publicKeyFingerprint: string | null;
    lastPasswordResetAt: string | null;
  } | null;
  // Attached databases
  databases: ReadonlyArray<{
    id: string;
    name: string;
    dbType: string;
    host: string | null;
    port: number | null;
    sizeMb: number;
    phpmyadminUrl: string | null;
  }>;
  // Backup history
  backups: ReadonlyArray<{
    id: string;
    kind: string;
    status: string;
    sizeBytes: number;
    startedAt: string | null;
    completedAt: string | null;
    expiresAt: string | null;
  }>;
  // Per-site audit trail
  activity: ReadonlyArray<{
    id: string;
    actionKey: string;
    actorEmail: string | null;
    decision: string;
    createdAt: string;
    beforeJson: unknown;
    afterJson: unknown;
  }>;
};

export const loadWebsiteDetail = async (id: string): Promise<WebsiteDetail | null> => {
  if (!isPanelDbConfigured()) return null;

  const baseRows = await panelQuery<{
    id: string;
    domain: string | null;
    status: string;
    tenantid: string | null;
    tenantname: string | null;
    hostingtype: string | null;
    runtime: string | null;
    createdat: string | null;
    updatedat: string | null;
  }>(
    `SELECT w.id,
            w."primaryDomain" AS domain,
            COALESCE(w.status, 'unknown') AS status,
            w."tenantId" AS tenantid,
            t.name AS tenantname,
            w."hostingType" AS hostingtype,
            w.runtime,
            w."createdAt"::text AS createdat,
            w."updatedAt"::text AS updatedat
       FROM websites w
       LEFT JOIN tenants t ON t.id = w."tenantId"
      WHERE w.id = $1`,
    [id],
  );
  if (baseRows.length === 0) return null;
  const base = baseRows[0]!;

  // SSL certs are linked by tenantId + domain name (no website FK in this schema)
  const [sslActive, sslExpiring, deployments, deploy30d, lastDeploy, tasks, relDomains, metrics, envVars, cronJobs, sftp, databases, backups, activity] = await Promise.all([
    panelQuery<{ count: string }>(
      `SELECT COUNT(*)::int::text AS count
         FROM ssl_certificates
        WHERE "tenantId" = $1
          AND ("domainName" = $2 OR "domainName" LIKE '%.' || $2)
          AND COALESCE(status, 'active') = 'active'
          AND ("expiresAt" IS NULL OR "expiresAt" > NOW())`,
      [base.tenantid || "", base.domain || ""],
    ),
    panelQuery<{ id: string; domainname: string | null; expiresat: string | null; provider: string | null; status: string; autorenew: boolean }>(
      `SELECT id, "domainName" AS domainname, "expiresAt"::text AS expiresat, provider, COALESCE(status, 'active') AS status, "autoRenew" AS autorenew
         FROM ssl_certificates
        WHERE "tenantId" = $1
          AND ("domainName" = $2 OR "domainName" LIKE '%.' || $2)
          AND "expiresAt" IS NOT NULL
          AND "expiresAt" < NOW() + INTERVAL '60 days'
        ORDER BY "expiresAt" ASC
        LIMIT 10`,
      [base.tenantid || "", base.domain || ""],
    ),
    panelQuery<{ id: string; name: string; type: string; status: string; createdat: string | null; completedat: string | null }>(
      `SELECT id::text, name, type, COALESCE(status, 'unknown') AS status,
              created_at::text AS createdat, completed_at::text AS completedat
         FROM deployments
        WHERE tenant_id = $1
        ORDER BY created_at DESC NULLS LAST
        LIMIT 10`,
      [base.tenantid || ""],
    ),
    panelQuery<{ count: string }>(
      `SELECT COUNT(*)::int::text AS count FROM deployments WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '30 days'`,
      [base.tenantid || ""],
    ),
    panelQuery<{ status: string | null; createdat: string | null }>(
      `SELECT COALESCE(status, 'unknown') AS status, created_at::text AS createdat FROM deployments WHERE tenant_id = $1 ORDER BY created_at DESC NULLS LAST LIMIT 1`,
      [base.tenantid || ""],
    ),
    panelQuery<{ id: string; type: string | null; status: string; createdat: string | null }>(
      `SELECT id, type, COALESCE(status, 'queued') AS status, "createdAt"::text AS createdat
         FROM provisioning_tasks
        WHERE "serviceInstanceId" = $1
          AND status NOT IN ('completed', 'succeeded')
        ORDER BY "createdAt" DESC NULLS LAST
        LIMIT 10`,
      [id],
    ),
    panelQuery<{ id: string; domain: string; role: string; status: string }>(
      `SELECT id, domain, role, status FROM domains WHERE "websiteId" = $1 ORDER BY "createdAt" ASC`,
      [id],
    ),
    panelQuery<{
      diskusedmb: string;
      bandwidthmbmonth: string;
      cpuavgpct: string;
      requestratepersec: string;
      lastcollectedat: string | null;
    }>(
      `SELECT disk_used_mb::text AS diskusedmb,
              bandwidth_mb_month::text AS bandwidthmbmonth,
              cpu_avg_pct::text AS cpuavgpct,
              request_rate_per_sec::text AS requestratepersec,
              last_collected_at::text AS lastcollectedat
         FROM website_metrics_rollup
        WHERE website_id = $1`,
      [id],
    ),
    panelQuery<{
      id: string;
      key: string;
      value: string;
      is_secret: boolean;
      updated_at: string | null;
    }>(
      `SELECT id,
              key,
              CASE WHEN is_secret THEN '••••••••' ELSE value END AS value,
              is_secret,
              updated_at::text AS updated_at
         FROM site_env_vars
        WHERE "websiteId" = $1
        ORDER BY key ASC`,
      [id],
    ),
    panelQuery<{
      id: string;
      name: string;
      schedule: string | null;
      command: string | null;
      status: string;
      lastrunat: string | null;
    }>(
      `SELECT j.id,
              COALESCE(j."payloadJson"->>'name', j.type) AS name,
              j."payloadJson"->>'schedule' AS schedule,
              j."payloadJson"->>'command' AS command,
              COALESCE(j.status, 'active') AS status,
              (SELECT MAX("startedAt")::text FROM job_runs WHERE jobid = j.id) AS lastrunat
         FROM jobs j
        WHERE j."websiteId" = $1
        ORDER BY COALESCE(j."payloadJson"->>'name', j.type) ASC`,
      [id],
    ),
    panelQuery<{
      username: string;
      host: string;
      port: number;
      homepath: string;
      publickeyfingerprint: string | null;
      lastpasswordresetat: string | null;
    }>(
      `SELECT username,
              host,
              port,
              home_path AS homepath,
              public_key_fingerprint AS publickeyfingerprint,
              last_password_reset_at::text AS lastpasswordresetat
         FROM sftp_accounts
        WHERE "websiteId" = $1`,
      [id],
    ),
    panelQuery<{
      id: string;
      name: string;
      dbtype: string;
      host: string | null;
      port: number | null;
      sizemb: string | null;
      phpmyadminurl: string | null;
    }>(
      `SELECT id,
              name,
              db_type AS dbtype,
              host,
              port,
              size_mb::text AS sizemb,
              phpmyadmin_url AS phpmyadminurl
         FROM site_databases
        WHERE "websiteId" = $1
        ORDER BY name ASC`,
      [id],
    ),
    panelQuery<{
      id: string;
      kind: string;
      status: string;
      sizebytes: string | null;
      startedat: string | null;
      completedat: string | null;
      expiresat: string | null;
    }>(
      `SELECT id,
              kind,
              status,
              size_bytes::text AS sizebytes,
              started_at::text AS startedat,
              completed_at::text AS completedat,
              expires_at::text AS expiresat
         FROM backup_runs
        WHERE "websiteId" = $1
        ORDER BY started_at DESC NULLS LAST
        LIMIT 20`,
      [id],
    ),
    panelQuery<{
      id: string;
      actionkey: string;
      actoremail: string | null;
      decision: string;
      createdat: string;
      beforejson: unknown;
      afterjson: unknown;
    }>(
      `SELECT a.id,
              a.actionkey,
              u.email AS actoremail,
              a.decision,
              a.createdat::text AS createdat,
              a.beforejson,
              a.afterjson
         FROM audit_events a
         LEFT JOIN users u ON u.id = a.actoruserid
        WHERE a.resourcetype = 'website'
          AND a.resourceid = $1
        ORDER BY a.createdat DESC
        LIMIT 30`,
      [id],
    ),
  ]);

  return {
    id: base.id,
    domain: base.domain,
    status: base.status,
    tenantId: base.tenantid,
    tenantName: base.tenantname,
    hostingType: base.hostingtype,
    runtime: base.runtime,
    runtimeControl: {
      current: base.runtime,
      available: AVAILABLE_HOSTING_RUNTIMES,
    },
    createdAt: base.createdat,
    updatedAt: base.updatedat,
    lastDeployAt: lastDeploy[0]?.createdat ?? null,
    lastDeployStatus: lastDeploy[0]?.status ?? null,
    deployCount30d: Number(deploy30d[0]?.count ?? 0),
    ssl: {
      activeCount: Number(sslActive[0]?.count ?? 0),
      expiringSoon: sslExpiring.map((s) => ({
        id: s.id,
        domainName: s.domainname,
        expiresAt: s.expiresat,
        provider: s.provider,
        status: s.status,
        autoRenew: s.autorenew,
      })),
    },
    deployments: deployments.map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      status: d.status,
      createdAt: d.createdat,
      completedAt: d.completedat,
    })),
    provisioningTasks: tasks.map((t) => ({
      id: t.id,
      type: t.type,
      status: t.status,
      createdAt: t.createdat,
    })),
    domains: relDomains,
    metrics: metrics[0]
      ? {
          diskUsedMb: Number(metrics[0].diskusedmb),
          bandwidthMbMonth: Number(metrics[0].bandwidthmbmonth),
          cpuAvgPct: Number(metrics[0].cpuavgpct),
          requestRatePerSec: Number(metrics[0].requestratepersec),
          lastCollectedAt: metrics[0].lastcollectedat,
        }
      : null,
    envVars: envVars.map((envVar) => ({
      id: envVar.id,
      key: envVar.key,
      value: envVar.value,
      isSecret: envVar.is_secret,
      updatedAt: envVar.updated_at,
    })),
    cronJobs: cronJobs.map((job) => ({
      id: job.id,
      name: job.name,
      schedule: job.schedule,
      command: job.command,
      status: job.status,
      lastRunAt: job.lastrunat,
      nextRunAt: null,
    })),
    sftp: sftp[0]
      ? {
          username: sftp[0].username,
          host: sftp[0].host,
          port: sftp[0].port,
          homePath: sftp[0].homepath,
          publicKeyFingerprint: sftp[0].publickeyfingerprint,
          lastPasswordResetAt: sftp[0].lastpasswordresetat,
        }
      : null,
    databases: databases.map((database) => ({
      id: database.id,
      name: database.name,
      dbType: database.dbtype,
      host: database.host,
      port: database.port,
      sizeMb: Number(database.sizemb ?? 0),
      phpmyadminUrl: database.phpmyadminurl,
    })),
    backups: backups.map((backup) => ({
      id: backup.id,
      kind: backup.kind,
      status: backup.status,
      sizeBytes: Number(backup.sizebytes ?? 0),
      startedAt: backup.startedat,
      completedAt: backup.completedat,
      expiresAt: backup.expiresat,
    })),
    activity: activity.map((event) => ({
      id: event.id,
      actionKey: event.actionkey,
      actorEmail: event.actoremail,
      decision: event.decision,
      createdAt: event.createdat,
      beforeJson: event.beforejson,
      afterJson: event.afterjson,
    })),
  };
};

