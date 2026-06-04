import { randomUUID } from "node:crypto";

import { auditLog } from "../audit";
import { panelExec, panelQuery } from "../db";

export const AVAILABLE_HOSTING_RUNTIMES = [
  "node-18",
  "node-20",
  "node-22",
  "php-7.4",
  "php-8.0",
  "php-8.1",
  "php-8.2",
  "php-8.3",
  "python-3.10",
  "python-3.11",
  "python-3.12",
  "static",
  "wordpress",
] as const;

type HostingAuditContext = {
  actorUserId?: string | null;
};

type QueueProvisioningTaskInput = {
  tenantId: string;
  websiteId: string;
  type: string;
  payload?: Record<string, unknown>;
};

const queueProvisioningTask = async ({ tenantId, websiteId, type, payload }: QueueProvisioningTaskInput) => {
  const taskId = randomUUID();
  const idempotencyKey = randomUUID();

  if (payload) {
    await panelExec(
      `INSERT INTO provisioning_tasks (id, "tenantId", "serviceInstanceId", type, status, "idempotencyKey", "createdAt", "payloadJson")
       VALUES ($1, $2, $3, $4, 'queued', $5, NOW(), $6::jsonb)`,
      [taskId, tenantId, websiteId, type, idempotencyKey, JSON.stringify(payload)],
    );
  } else {
    await panelExec(
      `INSERT INTO provisioning_tasks (id, "tenantId", "serviceInstanceId", type, status, "idempotencyKey", "createdAt")
       VALUES ($1, $2, $3, $4, 'queued', $5, NOW())`,
      [taskId, tenantId, websiteId, type, idempotencyKey],
    );
  }

  return { taskId, idempotencyKey };
};

const logWebsiteAudit = async (
  tenantId: string,
  websiteId: string,
  actorUserId: string | null | undefined,
  actionKey: string,
  beforeJson?: object,
  afterJson?: object,
) => {
  const payload: Parameters<typeof auditLog>[0] = {
    tenantId,
    actorUserId: actorUserId ?? null,
    actionKey,
    resourceType: "website",
    resourceId: websiteId,
    decision: "allow",
  };

  if (beforeJson) {
    payload.beforeJson = beforeJson;
  }
  if (afterJson) {
    payload.afterJson = afterJson;
  }

  await auditLog(payload);
};

export const loadWebsiteTenantId = async (websiteId: string): Promise<string | null> => {
  const rows = await panelQuery<{ tenantid: string }>(
    `SELECT "tenantId" AS tenantid FROM websites WHERE id = $1 LIMIT 1`,
    [websiteId],
  );
  return rows[0]?.tenantid ?? null;
};

export const queueRuntimeChange = async (
  tenantId: string,
  websiteId: string,
  runtime: string,
  audit?: HostingAuditContext,
) => {
  const currentRows = await panelQuery<{ runtime: string | null }>(
    `SELECT runtime FROM websites WHERE id = $1 LIMIT 1`,
    [websiteId],
  );
  const current = currentRows[0]?.runtime ?? null;

  await queueProvisioningTask({
    tenantId,
    websiteId,
    type: "runtime.upgrade",
    payload: { runtime },
  });
  await panelExec(`UPDATE websites SET runtime = $2, "updatedAt" = NOW() WHERE id = $1`, [websiteId, runtime]);
  await logWebsiteAudit(tenantId, websiteId, audit?.actorUserId, "website.runtime.changed", { runtime: current }, { runtime });
};

export const upsertWebsiteEnvVar = async (
  tenantId: string,
  websiteId: string,
  envVar: { key: string; value: string; isSecret?: boolean },
  audit?: HostingAuditContext,
) => {
  const rows = await panelQuery<{ id: string }>(
    `INSERT INTO site_env_vars (id, "websiteId", key, value, is_secret, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     ON CONFLICT ("websiteId", key)
     DO UPDATE SET value = EXCLUDED.value, is_secret = EXCLUDED.is_secret, updated_at = NOW()
     RETURNING id`,
    [randomUUID(), websiteId, envVar.key, envVar.value, envVar.isSecret ?? true],
  );
  await queueProvisioningTask({
    tenantId,
    websiteId,
    type: "runtime.restart",
    payload: { reason: "env_var_changed", key: envVar.key },
  });
  await logWebsiteAudit(tenantId, websiteId, audit?.actorUserId, "website.env_var.upserted", undefined, {
    key: envVar.key,
    isSecret: envVar.isSecret ?? true,
  });

  return rows[0]?.id ?? null;
};

export const deleteWebsiteEnvVar = async (
  tenantId: string,
  websiteId: string,
  envVarId: string,
  audit?: HostingAuditContext,
) => {
  const rows = await panelQuery<{ key: string }>(
    `DELETE FROM site_env_vars
      WHERE id = $1 AND "websiteId" = $2
      RETURNING key`,
    [envVarId, websiteId],
  );
  const deletedKey = rows[0]?.key ?? null;

  if (!deletedKey) {
    return false;
  }

  await queueProvisioningTask({
    tenantId,
    websiteId,
    type: "runtime.restart",
    payload: { reason: "env_var_deleted", envVarId },
  });
  await logWebsiteAudit(tenantId, websiteId, audit?.actorUserId, "website.env_var.deleted", deletedKey ? { key: deletedKey } : undefined, undefined);

  return true;
};

export const loadWebsiteEnvVarSecret = async (websiteId: string, envVarId: string): Promise<string | null> => {
  const rows = await panelQuery<{ value: string }>(
    `SELECT value FROM site_env_vars WHERE id = $1 AND "websiteId" = $2 LIMIT 1`,
    [envVarId, websiteId],
  );
  return rows[0]?.value ?? null;
};

export const loadWebsiteDatabaseManagerUrl = async (
  websiteId: string,
  databaseId: string,
): Promise<string | null> => {
  const rows = await panelQuery<{ phpmyadminurl: string | null }>(
    `SELECT phpmyadmin_url AS phpmyadminurl
       FROM site_databases
      WHERE id = $1 AND "websiteId" = $2
      LIMIT 1`,
    [databaseId, websiteId],
  );
  return rows[0]?.phpmyadminurl ?? null;
};

export const loadWebsiteBackupTarget = async (
  websiteId: string,
  backupId: string,
): Promise<{
  id: string;
  tenantId: string;
  status: string;
  storageUrl: string | null;
} | null> => {
  const rows = await panelQuery<{
    id: string;
    tenantid: string;
    status: string;
    storageurl: string | null;
  }>(
    `SELECT id,
            "tenantId" AS tenantid,
            status,
            storage_url AS storageurl
       FROM backup_runs
      WHERE id = $1 AND "websiteId" = $2
      LIMIT 1`,
    [backupId, websiteId],
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    tenantId: row.tenantid,
    status: row.status,
    storageUrl: row.storageurl,
  };
};

export const loadAndDeleteWebsiteSftpPasswordReveal = async (
  websiteId: string,
): Promise<{ id: string; password: string; createdAt: string | null } | null> => {
  const rows = await panelQuery<{ id: string; password: string; createdat: string | null }>(
    `DELETE FROM sftp_password_reveals
      WHERE id = (
        SELECT id
          FROM sftp_password_reveals
         WHERE "websiteId" = $1
         ORDER BY created_at DESC
         LIMIT 1
      )
      RETURNING id, password, created_at::text AS createdat`,
    [websiteId],
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    password: row.password,
    createdAt: row.createdat,
  };
};

export const runCronJobNow = async (jobId: string) => {
  await panelExec(
    `INSERT INTO job_runs (id, jobid, status, "startedAt") VALUES ($1, $2, 'pending', NOW())`,
    [randomUUID(), jobId],
  );
};

export const loadWebsiteCronJobContext = async (
  websiteId: string,
  jobId: string,
): Promise<{ id: string; tenantId: string } | null> => {
  const rows = await panelQuery<{ id: string; tenantid: string }>(
    `SELECT j.id,
            w."tenantId" AS tenantid
       FROM jobs j
       JOIN websites w ON w.id = j."websiteId"
      WHERE j.id = $1 AND j."websiteId" = $2
      LIMIT 1`,
    [jobId, websiteId],
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    tenantId: row.tenantid,
  };
};

export const upsertWebsiteCronJob = async (
  tenantId: string,
  websiteId: string,
  job: {
    id?: string;
    type: string;
    name: string;
    schedule?: string | null;
    command?: string | null;
    status?: string;
  },
  audit?: HostingAuditContext,
) => {
  const jobId = job.id ?? randomUUID();
  const payload = {
    name: job.name,
    ...(job.schedule ? { schedule: job.schedule } : {}),
    ...(job.command ? { command: job.command } : {}),
  };

  if (job.id) {
    const rows = await panelQuery<{ id: string }>(
      `UPDATE jobs
          SET type = $2,
              status = $3,
              "targetType" = 'website',
              "targetId" = $4,
              "websiteId" = $4,
              "payloadJson" = $5::jsonb
        WHERE id = $1
          AND "websiteId" = $4
        RETURNING id`,
      [jobId, job.type, job.status ?? 'active', websiteId, JSON.stringify(payload)],
    );
    if (!rows[0]?.id) {
      return null;
    }
  } else {
    await panelExec(
      `INSERT INTO jobs (id, "tenantId", type, status, "targetType", "targetId", "websiteId", "idempotencyKey", "payloadJson", "createdAt")
       VALUES ($1, $2, $3, $4, 'website', $5, $5, $6, $7::jsonb, NOW())`,
      [jobId, tenantId, job.type, job.status ?? 'active', websiteId, randomUUID(), JSON.stringify(payload)],
    );
  }

  await logWebsiteAudit(
    tenantId,
    websiteId,
    audit?.actorUserId,
    job.id ? 'website.cron.updated' : 'website.cron.created',
    undefined,
    { jobId, type: job.type, name: job.name, schedule: job.schedule ?? null },
  );

  return jobId;
};

export const deleteWebsiteCronJob = async (
  tenantId: string,
  websiteId: string,
  jobId: string,
  audit?: HostingAuditContext,
) => {
  const rows = await panelQuery<{ id: string }>(
    `UPDATE jobs
        SET status = 'deleted',
            "websiteId" = $2
      WHERE id = $1
        AND "websiteId" = $2
      RETURNING id`,
    [jobId, websiteId],
  );
  if (!rows[0]?.id) {
    return false;
  }
  await logWebsiteAudit(tenantId, websiteId, audit?.actorUserId, 'website.cron.deleted', { jobId }, undefined);

  return true;
};

export const queueWebsiteCronRunNow = async (
  tenantId: string,
  websiteId: string,
  jobId: string,
  audit?: HostingAuditContext,
) => {
  await runCronJobNow(jobId);
  await logWebsiteAudit(tenantId, websiteId, audit?.actorUserId, "website.cron.run_requested", undefined, { jobId });
};

export const queueBackupRestore = async (
  tenantId: string,
  websiteId: string,
  backupId: string,
  audit?: HostingAuditContext,
) => {
  await queueProvisioningTask({
    tenantId,
    websiteId,
    type: "hosting.restore",
    payload: { backupId },
  });
  await logWebsiteAudit(tenantId, websiteId, audit?.actorUserId, "website.backup.restore_queued", undefined, { backupId });
};

export const queueSftpPasswordReset = async (
  tenantId: string,
  websiteId: string,
  audit?: HostingAuditContext,
) => {
  await queueProvisioningTask({
    tenantId,
    websiteId,
    type: "sftp.password.reset",
  });
  await logWebsiteAudit(tenantId, websiteId, audit?.actorUserId, "website.sftp.password_reset_queued");
};