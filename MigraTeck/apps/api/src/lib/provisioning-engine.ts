import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getDb } from "./db.js";
import { publishPlatformEvent } from "./platform-events.js";
import {
  hashCanonicalPayload,
  verifyProvisioningEnvelope,
} from "./provisioning-crypto.js";
import {
  executeProvisioningJob,
  type ProvisioningExecutionResult,
  type ProvisioningJobRecord,
} from "./provisioning-provider.js";

function backoffBaseSeconds(): number {
  const parsed = Number(process.env.PROVISIONING_JOB_BACKOFF_BASE_SECONDS ?? 30);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

function staleLockSeconds(): number {
  const parsed = Number(process.env.PROVISIONING_STALE_LOCK_SECONDS ?? 900);
  return Number.isFinite(parsed) && parsed >= 60 ? parsed : 900;
}

function nextBackoffDate(attempts: number): Date {
  const seconds = Math.min(
    60 * 60,
    backoffBaseSeconds() * 2 ** Math.max(0, attempts - 1),
  );
  return new Date(Date.now() + seconds * 1000);
}

type QueryExecutor = Pick<PoolClient, "query">;

async function appendEvent(
  jobId: string,
  status: string,
  message: string,
  metadata?: Record<string, unknown>,
  database: QueryExecutor = getDb(),
): Promise<void> {
  await database.query(
    'INSERT INTO "ProvisioningJobEvent" (id,"jobId",status,message,metadata,"createdAt") VALUES ($1,$2,$3::"ProvisioningJobStatus",$4,$5::jsonb,NOW())',
    [
      randomUUID(),
      jobId,
      status,
      message,
      metadata ? JSON.stringify(metadata) : null,
    ],
  );
}

async function writeAudit(
  input: {
    actorId?: string | null;
    orgId?: string | null;
    action: string;
    entityId: string;
    metadata?: Record<string, unknown>;
  },
  database: QueryExecutor = getDb(),
): Promise<void> {
  await database.query(
    'INSERT INTO "AuditLog" (id,"userId","orgId",action,"entityType","entityId",metadata,"createdAt") VALUES ($1,$2,$3,$4,\'provisioning_job\',$5,$6::jsonb,NOW())',
    [
      randomUUID(),
      input.actorId ?? null,
      input.orgId ?? null,
      input.action,
      input.entityId,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

function publicFailureCode(message: string): string {
  const normalized = message.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{0,79}$/.test(normalized)
    ? normalized
    : "provisioning_failure";
}

async function markDead(
  job: ProvisioningJobRecord,
  message: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const client = await getDb().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      'UPDATE "ProvisioningJob" SET status=\'DEAD\'::"ProvisioningJobStatus","lastError"=$2,"lastErrorAt"=NOW(),"lockedAt"=NULL,"lockedBy"=NULL,"finishedAt"=NOW(),"updatedAt"=NOW() WHERE id=$1',
      [job.id, message],
    );
    await appendEvent(job.id, "DEAD", message, metadata, client);
    await writeAudit(
      {
        actorId: job.createdByActorId,
        orgId: job.orgId,
        action: "PROVISIONING_JOB_DEAD_LETTERED",
        entityId: job.id,
        metadata: {
          reason: message,
          attempts: job.attempts,
          maxAttempts: job.maxAttempts,
          ...(metadata ?? {}),
        },
      },
      client,
    );
    await publishPlatformEvent(client, {
      eventType: "provisioning.job_dead",
      source: "migrateck-provisioning-worker",
      orgId: job.orgId,
      actorId: job.createdByActorId,
      entityType: "provisioning_job",
      entityId: job.id,
      payload: {
        job_id: job.id,
        source: job.source,
        type: job.type,
        attempts: job.attempts,
        max_attempts: job.maxAttempts,
        reason_code: publicFailureCode(message),
      },
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function markSucceeded(
  job: ProvisioningJobRecord,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const client = await getDb().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      'UPDATE "ProvisioningJob" SET status=\'SUCCEEDED\'::"ProvisioningJobStatus","lastError"=NULL,"lastErrorAt"=NULL,"finishedAt"=NOW(),"lockedAt"=NULL,"lockedBy"=NULL,"updatedAt"=NOW() WHERE id=$1',
      [job.id],
    );
    await appendEvent(
      job.id,
      "SUCCEEDED",
      "succeeded",
      {
        workerId: job.lockedBy,
        ...(metadata ?? {}),
      },
      client,
    );
    await writeAudit(
      {
        actorId: job.createdByActorId,
        orgId: job.orgId,
        action: "PROVISIONING_JOB_SUCCEEDED",
        entityId: job.id,
        metadata: {
          source: job.source,
          type: job.type,
          attempts: job.attempts,
          workerId: job.lockedBy,
          ...(metadata ?? {}),
        },
      },
      client,
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function scheduleRetry(
  job: ProvisioningJobRecord,
  result: Extract<ProvisioningExecutionResult, { kind: "RETRYABLE_FAILURE" }>,
): Promise<void> {
  const notBefore = nextBackoffDate(job.attempts);
  const client = await getDb().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      'UPDATE "ProvisioningJob" SET status=\'PENDING\'::"ProvisioningJobStatus","notBefore"=$2,"lastError"=$3,"lastErrorAt"=NOW(),"lockedAt"=NULL,"lockedBy"=NULL,"updatedAt"=NOW() WHERE id=$1',
      [job.id, notBefore, result.message],
    );
    await appendEvent(
      job.id,
      "PENDING",
      "retry_scheduled",
      {
        nextRunAt: notBefore.toISOString(),
        reason: result.message,
        ...(result.metadata ?? {}),
      },
      client,
    );
    await writeAudit(
      {
        actorId: job.createdByActorId,
        orgId: job.orgId,
        action: "PROVISIONING_JOB_RETRY_SCHEDULED",
        entityId: job.id,
        metadata: {
          attempts: job.attempts,
          maxAttempts: job.maxAttempts,
          nextRunAt: notBefore.toISOString(),
          reason: result.message,
        },
      },
      client,
    );
    await publishPlatformEvent(client, {
      eventType: "provisioning.job_failed",
      source: "migrateck-provisioning-worker",
      orgId: job.orgId,
      actorId: job.createdByActorId,
      entityType: "provisioning_job",
      entityId: job.id,
      payload: {
        job_id: job.id,
        source: job.source,
        type: job.type,
        attempt: job.attempts,
        max_attempts: job.maxAttempts,
        next_run_at: notBefore.toISOString(),
        reason_code: publicFailureCode(result.message),
      },
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function platformProvisioningPaused(): Promise<boolean> {
  const result = await getDb().query<{
    maintenanceMode: boolean;
    pauseProvisioningWorker: boolean;
  }>(
    'SELECT "maintenanceMode","pauseProvisioningWorker" FROM "PlatformConfig" ORDER BY "updatedAt" DESC LIMIT 1',
  );
  const row = result.rows[0];
  return Boolean(row?.maintenanceMode || row?.pauseProvisioningWorker);
}

export async function recoverStaleProvisioningJobs(): Promise<number> {
  const result = await getDb().query<{ id: string }>(
    'UPDATE "ProvisioningJob" SET status=\'PENDING\'::"ProvisioningJobStatus","notBefore"=NOW(),"lastError"=\'stale_lock_recovered\',"lastErrorAt"=NOW(),"lockedAt"=NULL,"lockedBy"=NULL,"updatedAt"=NOW() WHERE status=\'RUNNING\'::"ProvisioningJobStatus" AND "lockedAt" IS NOT NULL AND "lockedAt" < NOW() - ($1::int * interval \'1 second\') RETURNING id',
    [staleLockSeconds()],
  );
  for (const row of result.rows) {
    await appendEvent(row.id, "PENDING", "stale_lock_recovered");
  }
  return result.rowCount ?? 0;
}

export async function claimProvisioningJobs(
  workerId: string,
  limit: number,
): Promise<ProvisioningJobRecord[]> {
  const client = await getDb().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<ProvisioningJobRecord>(
      `WITH candidates AS (
         SELECT id
         FROM "ProvisioningJob"
         WHERE status='PENDING'::"ProvisioningJobStatus"
           AND ("notBefore" IS NULL OR "notBefore" <= NOW())
         ORDER BY "createdAt" ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE "ProvisioningJob" AS j
       SET status='RUNNING'::"ProvisioningJobStatus",
           attempts=j.attempts+1,
           "lockedAt"=NOW(),
           "lockedBy"=$2,
           "startedAt"=COALESCE(j."startedAt",NOW()),
           "updatedAt"=NOW()
       FROM candidates c
       WHERE j.id=c.id
       RETURNING j.*`,
      [Math.max(1, Math.min(limit, 100)), workerId],
    );
    await client.query("COMMIT");
    return result.rows;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function processClaimedJob(
  job: ProvisioningJobRecord,
  workerId: string,
): Promise<void> {
  const now = new Date();

  if (job.expiresAt && new Date(job.expiresAt) <= now) {
    await markDead(job, "job_expired");
    return;
  }

  const computedHash = hashCanonicalPayload(job.payload);
  if (computedHash !== job.payloadHash) {
    await markDead(job, "payload_hash_mismatch");
    return;
  }

  const signatureValid = verifyProvisioningEnvelope({
    jobId: job.id,
    orgId: job.orgId,
    type: job.type,
    payloadHash: job.payloadHash,
    createdAt: new Date(job.createdAt).toISOString(),
    expiresAt: job.expiresAt ? new Date(job.expiresAt).toISOString() : null,
    envelopeVersion: job.envelopeVersion,
    signature: job.signature,
  });

  if (!signatureValid) {
    await markDead(job, "invalid_signature");
    await writeAudit({
      actorId: job.createdByActorId,
      orgId: job.orgId,
      action: "PROVISIONING_JOB_SIGNATURE_INVALID",
      entityId: job.id,
    });
    return;
  }

  const result = await executeProvisioningJob(job, workerId);
  if (result.kind === "SUCCESS") {
    await markSucceeded(job, result.metadata);
    return;
  }

  if (result.kind === "RETRYABLE_FAILURE" && job.attempts < job.maxAttempts) {
    await scheduleRetry(job, result);
    return;
  }

  await markDead(job, result.message, {
    retryable: result.kind === "RETRYABLE_FAILURE",
    ...(result.metadata ?? {}),
  });
}

export async function processProvisioningBatch(
  workerId: string,
  limit = 25,
): Promise<number> {
  if (await platformProvisioningPaused()) return 0;

  const jobs = await claimProvisioningJobs(workerId, limit);
  let processed = 0;

  for (const job of jobs) {
    try {
      await processClaimedJob(job, workerId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "unknown_worker_error";
      if (job.attempts < job.maxAttempts) {
        await scheduleRetry(job, {
          kind: "RETRYABLE_FAILURE",
          message: "worker_exception",
          metadata: { error: message },
        });
      } else {
        await markDead(job, "worker_exception", { error: message });
      }
    }
    processed += 1;
  }

  return processed;
}
