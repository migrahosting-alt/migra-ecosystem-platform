import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getDb } from "./db.js";
import {
  ENTITLEMENT_STATUSES,
  PRODUCT_KEYS,
  type EntitlementStatus,
  type ProductKey,
} from "./commerce-catalog.js";
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
import { provisioningProductAllowlist } from "./provisioning-policy.js";

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

type JsonRecord = Record<string, unknown>;

type DeferredEntitlementIntent = {
  transitionId: string;
  product: ProductKey;
  previousStatus: EntitlementStatus;
  newStatus: EntitlementStatus;
  entitlementId: string;
  expectedUpdatedAt: Date | null;
  startsAt: Date | null;
  endsAt: Date | null;
  notes: string | null;
};

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as JsonRecord;
}

function stringField(record: JsonRecord, key: string): string | null {
  const value = record[key];
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function nullableDateField(record: JsonRecord, key: string): Date | null | undefined {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function deferredEntitlementIntent(
  job: Pick<ProvisioningJobRecord, "payload">,
): DeferredEntitlementIntent | null {
  const payload = asRecord(job.payload);
  if (
    payload.intent !== "org_entitlement_transition" ||
    payload.entitlementApplyMode !== "after_all_jobs_succeed"
  ) {
    return null;
  }

  const transitionId = stringField(payload, "transitionId");
  const product = stringField(payload, "product");
  const previousStatus = stringField(payload, "previousStatus");
  const newStatus = stringField(payload, "newStatus");
  const entitlementId = stringField(payload, "entitlementId");
  const expectedUpdatedAt = nullableDateField(
    payload,
    "entitlementExpectedUpdatedAt",
  );
  const startsAt = nullableDateField(payload, "entitlementStartsAt");
  const endsAt = nullableDateField(payload, "entitlementEndsAt");
  const notesValue = payload.entitlementNotes;
  const notes =
    notesValue === null || typeof notesValue === "string"
      ? notesValue
      : undefined;

  if (
    !transitionId ||
    !product ||
    !previousStatus ||
    !newStatus ||
    !entitlementId ||
    expectedUpdatedAt === undefined ||
    startsAt === undefined ||
    endsAt === undefined ||
    notes === undefined ||
    !(PRODUCT_KEYS as readonly string[]).includes(product) ||
    !(ENTITLEMENT_STATUSES as readonly string[]).includes(previousStatus) ||
    !(ENTITLEMENT_STATUSES as readonly string[]).includes(newStatus)
  ) {
    return null;
  }

  return {
    transitionId,
    product: product as ProductKey,
    previousStatus: previousStatus as EntitlementStatus,
    newStatus: newStatus as EntitlementStatus,
    entitlementId,
    expectedUpdatedAt,
    startsAt,
    endsAt,
    notes,
  };
}

async function updateProvisioningTaskState(
  database: QueryExecutor,
  job: ProvisioningJobRecord,
  input: {
    status: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED";
    runAfter?: Date | null;
    lastError?: string | null;
  },
): Promise<void> {
  await database.query(
    `UPDATE "ProvisioningTask"
     SET status=$2::"ProvisioningTaskStatus",
         attempts=$3,
         "runAfter"=$4,
         "lastError"=$5,
         "updatedAt"=NOW()
     WHERE "orgId"=$1
       AND payload->>'jobId'=$6`,
    [
      job.orgId,
      input.status,
      job.attempts,
      input.runAfter ?? null,
      input.lastError ?? null,
      job.id,
    ],
  );
}

async function finalizeDeferredEntitlementTransition(
  transitionId: string,
): Promise<boolean> {
  const client = await getDb().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      transitionId,
    ]);

    const jobs = await client.query<{
      id: string;
      orgId: string;
      createdByActorId: string | null;
      status: string;
      payload: unknown;
    }>(
      `SELECT j.id,j."orgId",j."createdByActorId",j.status::text AS status,j.payload
       FROM "ProvisioningJob" j
       WHERE j.source='MANUAL'::"ProvisioningJobSource"
         AND j.payload->>'intent'='org_entitlement_transition'
         AND j.payload->>'entitlementApplyMode'='after_all_jobs_succeed'
         AND j.payload->>'transitionId'=$1
         AND NOT EXISTS (
           SELECT 1
           FROM "ProvisioningJob" replacement
           WHERE replacement.payload->>'recoverySourceJobId'=j.id
             AND replacement.payload->>'transitionId'=j.payload->>'transitionId'
         )
       ORDER BY j."createdAt" ASC
       FOR UPDATE OF j`,
      [transitionId],
    );

    if (jobs.rows.length === 0 || jobs.rows.some((row) => row.status !== "SUCCEEDED")) {
      await client.query("COMMIT");
      return false;
    }

    const first = jobs.rows[0]!;
    const intent = deferredEntitlementIntent({ payload: first.payload });
    if (!intent) {
      await client.query("COMMIT");
      return false;
    }

    const terminalAudit = await client.query<{ action: string }>(
      `SELECT action
       FROM "AuditLog"
       WHERE action = ANY($2::text[])
         AND metadata->>'transitionId'=$1
       ORDER BY "createdAt" DESC
       LIMIT 1`,
      [
        transitionId,
        ["ORG_ENTITLEMENT_TRANSITION_APPLIED", "ORG_ENTITLEMENT_TRANSITION_STALE"],
      ],
    );
    if (terminalAudit.rows[0]) {
      await client.query("COMMIT");
      return terminalAudit.rows[0].action === "ORG_ENTITLEMENT_TRANSITION_APPLIED";
    }

    const current = await client.query<{
      id: string;
      status: string;
      updatedAt: Date;
    }>(
      `SELECT id,status::text AS status,"updatedAt"
       FROM "OrgEntitlement"
       WHERE "orgId"=$1 AND product=$2::"ProductKey"
       FOR UPDATE`,
      [first.orgId, intent.product],
    );
    const actualStatus = current.rows[0]?.status ?? "RESTRICTED";
    const actualUpdatedAt = current.rows[0]?.updatedAt
      ? new Date(current.rows[0].updatedAt).toISOString()
      : null;
    const expectedUpdatedAt = intent.expectedUpdatedAt
      ? intent.expectedUpdatedAt.toISOString()
      : null;

    if (
      actualStatus !== intent.previousStatus ||
      actualUpdatedAt !== expectedUpdatedAt
    ) {
      await client.query(
        `INSERT INTO "AuditLog"
          (id,"userId","orgId",action,"entityType","entityId",metadata,"createdAt")
         VALUES ($1,$2,$3,'ORG_ENTITLEMENT_TRANSITION_STALE','org_entitlement',$4,$5::jsonb,NOW())`,
        [
          randomUUID(),
          first.createdByActorId,
          first.orgId,
          intent.entitlementId,
          JSON.stringify({
            transitionId,
            product: intent.product,
            expectedPreviousStatus: intent.previousStatus,
            actualStatus,
            expectedUpdatedAt,
            actualUpdatedAt,
            desiredStatus: intent.newStatus,
            jobs: jobs.rows.map((row) => row.id),
          }),
        ],
      );
      await client.query("COMMIT");
      return false;
    }

    const updated = await client.query<{
      id: string;
      status: string;
      startsAt: Date | null;
      endsAt: Date | null;
      notes: string | null;
      updatedAt: Date;
    }>(
      `INSERT INTO "OrgEntitlement"
         (id,"orgId",product,status,"startsAt","endsAt",notes,"createdAt","updatedAt")
       VALUES ($1,$2,$3::"ProductKey",$4::"EntitlementStatus",$5,$6,$7,NOW(),NOW())
       ON CONFLICT ("orgId",product)
       DO UPDATE SET
         status=EXCLUDED.status,
         "startsAt"=EXCLUDED."startsAt",
         "endsAt"=EXCLUDED."endsAt",
         notes=EXCLUDED.notes,
         "updatedAt"=NOW()
       RETURNING id,status::text AS status,"startsAt","endsAt",notes,"updatedAt"`,
      [
        intent.entitlementId,
        first.orgId,
        intent.product,
        intent.newStatus,
        intent.startsAt,
        intent.endsAt,
        intent.notes,
      ],
    );

    await client.query(
      `INSERT INTO "AuditLog"
        (id,"userId","orgId",action,"entityType","entityId",metadata,"createdAt")
       VALUES ($1,$2,$3,'ORG_ENTITLEMENT_TRANSITION_APPLIED','org_entitlement',$4,$5::jsonb,NOW())`,
      [
        randomUUID(),
        first.createdByActorId,
        first.orgId,
        intent.entitlementId,
        JSON.stringify({
          transitionId,
          product: intent.product,
          previousStatus: intent.previousStatus,
          status: intent.newStatus,
          jobs: jobs.rows.map((row) => row.id),
          provisioningCompleted: true,
        }),
      ],
    );

    const entitlement = updated.rows[0]!;
    await publishPlatformEvent(client, {
      eventType: "entitlement.granted",
      source: "migrateck-provisioning-worker",
      orgId: first.orgId,
      actorId: first.createdByActorId,
      entityType: "org_entitlement",
      entityId: intent.entitlementId,
      payload: {
        product: intent.product,
        previous_status: intent.previousStatus,
        status: intent.newStatus,
        starts_at: entitlement.startsAt ?? null,
        ends_at: entitlement.endsAt ?? null,
        transition_id: transitionId,
        provisioning_job_ids: jobs.rows.map((row) => row.id),
      },
    });

    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function reconcileDeferredEntitlementTransitions(
  limit = 25,
): Promise<number> {
  const candidates = await getDb().query<{ transitionId: string }>(
    `WITH effective AS (
       SELECT j.*
       FROM "ProvisioningJob" j
       WHERE j.source='MANUAL'::"ProvisioningJobSource"
         AND j.payload->>'intent'='org_entitlement_transition'
         AND j.payload->>'entitlementApplyMode'='after_all_jobs_succeed'
         AND j.payload->>'transitionId' IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM "ProvisioningJob" replacement
           WHERE replacement.payload->>'recoverySourceJobId'=j.id
             AND replacement.payload->>'transitionId'=j.payload->>'transitionId'
         )
     ),
     complete AS (
       SELECT
         payload->>'transitionId' AS transition_id,
         min("createdAt") AS first_created
       FROM effective
       GROUP BY payload->>'transitionId'
       HAVING bool_and(status='SUCCEEDED'::"ProvisioningJobStatus")
     )
     SELECT transition_id AS "transitionId"
     FROM complete c
     WHERE NOT EXISTS (
       SELECT 1
       FROM "AuditLog" a
       WHERE a.action = ANY($2::text[])
         AND a.metadata->>'transitionId'=c.transition_id
     )
     ORDER BY c.first_created ASC
     LIMIT $1`,
    [
      Math.max(1, Math.min(limit, 100)),
      ["ORG_ENTITLEMENT_TRANSITION_APPLIED", "ORG_ENTITLEMENT_TRANSITION_STALE"],
    ],
  );

  let applied = 0;
  for (const row of candidates.rows) {
    if (await finalizeDeferredEntitlementTransition(row.transitionId)) {
      applied += 1;
    }
  }
  return applied;
}

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
    await updateProvisioningTaskState(client, job, {
      status: "FAILED",
      lastError: message,
    });
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
    await updateProvisioningTaskState(client, job, {
      status: "SUCCEEDED",
      lastError: null,
    });
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
    await updateProvisioningTaskState(client, job, {
      status: "PENDING",
      runAfter: notBefore,
      lastError: result.message,
    });
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
  const result = await getDb().query<{ id: string; orgId: string }>(
    'UPDATE "ProvisioningJob" SET status=\'PENDING\'::"ProvisioningJobStatus","notBefore"=NOW(),"lastError"=\'stale_lock_recovered\',"lastErrorAt"=NOW(),"lockedAt"=NULL,"lockedBy"=NULL,"updatedAt"=NOW() WHERE status=\'RUNNING\'::"ProvisioningJobStatus" AND "lockedAt" IS NOT NULL AND "lockedAt" < NOW() - ($1::int * interval \'1 second\') RETURNING id,"orgId"',
    [staleLockSeconds()],
  );
  for (const row of result.rows) {
    await appendEvent(row.id, "PENDING", "stale_lock_recovered");
    await getDb().query(
      `UPDATE "ProvisioningTask"
       SET status='PENDING'::"ProvisioningTaskStatus",
           "runAfter"=NOW(),
           "lastError"='stale_lock_recovered',
           "updatedAt"=NOW()
       WHERE "orgId"=$1 AND payload->>'jobId'=$2`,
      [row.orgId, row.id],
    );
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
    const allowlist = provisioningProductAllowlist();
    const result = await client.query<ProvisioningJobRecord>(
      `WITH candidates AS (
         SELECT id
         FROM "ProvisioningJob"
         WHERE status='PENDING'::"ProvisioningJobStatus"
           AND ("notBefore" IS NULL OR "notBefore" <= NOW())
           AND (
             cardinality($3::text[]) = 0
             OR UPPER(COALESCE(payload->>'productLane',payload->>'product','')) = ANY($3::text[])
           )
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
      [Math.max(1, Math.min(limit, 100)), workerId, allowlist],
    );
    for (const job of result.rows) {
      await updateProvisioningTaskState(client, job, {
        status: "PROCESSING",
        lastError: null,
      });
    }
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

  try {
    await reconcileDeferredEntitlementTransitions(Math.max(limit, 25));
  } catch (error) {
    console.error(
      "[migrateck-provisioning-worker] deferred entitlement reconciliation failed",
      error,
    );
  }

  return processed;
}
