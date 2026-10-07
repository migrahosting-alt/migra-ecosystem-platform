import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getDb } from "./db.js";
import {
  getProvisioningInputDescriptors,
  getProvisioningWorkerStatus,
} from "./commerce-entitlements.js";
import {
  getHostingRecoveryCandidates,
  type HostingRecoveryCandidate,
} from "./hosting-integration.js";
import {
  hashCanonicalPayload,
  signProvisioningEnvelope,
  verifyProvisioningEnvelope,
} from "./provisioning-crypto.js";

export type DeadLetterRecoveryContext = {
  domain?: string | undefined;
  tenantId?: string | undefined;
  serviceInstanceId?: string | undefined;
  targetIp?: string | undefined;
  plan?: string | undefined;
  mailboxEmail?: string | undefined;
};

type DeadJobRow = {
  id: string;
  orgId: string;
  createdByActorId: string | null;
  orgName: string | null;
  orgSlug: string | null;
  source: string;
  type: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  idempotencyKey: string;
  envelopeVersion: number;
  payload: unknown;
  payloadHash: string;
  signature: string;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type RecoveryContract = {
  supported: boolean;
  requiredFields: Array<keyof DeadLetterRecoveryContext>;
  reason: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function productLane(payload: Record<string, unknown>): string | null {
  return text(payload.productLane)?.toUpperCase() ?? text(payload.product)?.toUpperCase() ?? null;
}

function actionName(payload: Record<string, unknown>): string | null {
  return text(payload.action)?.toUpperCase() ?? null;
}

function hasEnv(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

function recoveryContract(product: string | null, action: string | null): RecoveryContract {
  if (product === "MIGRAHOSTING" && action === "POD_CREATE") {
    const configured =
      hasEnv("MIGRAHOSTING_AGENT_URL") &&
      hasEnv("MIGRAHOSTING_AGENT_KEY_ID") &&
      hasEnv("MIGRAHOSTING_AGENT_SECRET");
    return {
      supported: configured,
      requiredFields: ["domain", "tenantId", "serviceInstanceId"],
      reason: configured ? null : "MigraHosting agent recovery is not fully configured.",
    };
  }

  if (product === "MIGRAHOSTING" && action === "DNS_PROVISION") {
    const configured =
      hasEnv("MIGRAPANEL_EDGE_URL") &&
      hasEnv("MIGRAPANEL_EDGE_TOKEN");
    return {
      supported: configured,
      requiredFields: ["domain", "targetIp"],
      reason: configured ? null : "MigraPanel edge recovery is not fully configured.",
    };
  }

  if (product === "MIGRAMAIL" && action === "MAIL_DISABLE") {
    const configured =
      hasEnv("MIGRAMAIL_CORE_URL") &&
      hasEnv("MIGRAMAIL_CORE_API_KEY");
    return {
      supported: configured,
      requiredFields: ["mailboxEmail"],
      reason: configured ? null : "MigraMail recovery dispatcher is not fully configured.",
    };
  }

  return {
    supported: false,
    requiredFields: [],
    reason:
      "This dead-letter action has no audited replay contract. Resolve it through a fresh product-access transition instead.",
  };
}

function safeContext(payload: Record<string, unknown>): DeadLetterRecoveryContext {
  const result: DeadLetterRecoveryContext = {};
  for (const field of [
    "domain",
    "tenantId",
    "serviceInstanceId",
    "targetIp",
    "plan",
    "mailboxEmail",
  ] as const) {
    const value = text(payload[field]);
    if (value) result[field] = value;
  }
  return result;
}

function verifySource(job: DeadJobRow): {
  payloadHashValid: boolean;
  signatureValid: boolean;
} {
  const payloadHashValid = hashCanonicalPayload(job.payload) === job.payloadHash;
  let signatureValid = false;
  try {
    signatureValid = verifyProvisioningEnvelope({
      jobId: job.id,
      orgId: job.orgId,
      type: job.type,
      payloadHash: job.payloadHash,
      createdAt: new Date(job.createdAt).toISOString(),
      expiresAt: job.expiresAt ? new Date(job.expiresAt).toISOString() : null,
      envelopeVersion: job.envelopeVersion,
      signature: job.signature,
    });
  } catch {
    signatureValid = false;
  }
  return { payloadHashValid, signatureValid };
}

async function loadJob(
  client: PoolClient,
  jobId: string,
  lock: boolean,
): Promise<DeadJobRow | null> {
  const query =
    `SELECT
       j.id,j."orgId",j."createdByActorId",
       o.name AS "orgName",o.slug AS "orgSlug",
       j.source::text AS source,j.type::text AS type,j.status::text AS status,
       j.attempts,j."maxAttempts",j."lastError",j."idempotencyKey",
       j."envelopeVersion",j.payload,j."payloadHash",j.signature,
       j."expiresAt",j."createdAt",j."updatedAt"
     FROM "ProvisioningJob" j
     LEFT JOIN "Organization" o ON o.id=j."orgId"
     WHERE j.id=$1` + (lock ? " FOR UPDATE OF j" : "");
  const result = await client.query<DeadJobRow>(query, [jobId]);
  return result.rows[0] ?? null;
}

async function isMalformed(client: PoolClient, jobId: string): Promise<boolean> {
  const result = await client.query<{ malformed: boolean }>(
    `SELECT EXISTS(
       SELECT 1
       FROM "ProvisioningJobEvent"
       WHERE "jobId"=$1
         AND lower(COALESCE(metadata->>'malformed','false'))='true'
     ) AS malformed`,
    [jobId],
  );
  return Boolean(result.rows[0]?.malformed);
}

function workerAllowsProduct(product: string | null): boolean {
  const raw = process.env.PROVISIONING_WORKER_PRODUCT_ALLOWLIST?.trim();
  if (!raw) return true;
  if (!product) return false;

  const allowlist = new Set(
    raw
      .split(",")
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean),
  );
  return allowlist.has(product.toUpperCase());
}

async function provisioningPaused(client: PoolClient): Promise<boolean> {
  const result = await client.query<{
    maintenanceMode: boolean;
    pauseProvisioningWorker: boolean;
  }>(
    'SELECT "maintenanceMode","pauseProvisioningWorker" FROM "PlatformConfig" ORDER BY "updatedAt" DESC LIMIT 1',
  );
  const row = result.rows[0];
  return Boolean(row?.maintenanceMode || row?.pauseProvisioningWorker);
}

async function appendEvent(
  client: PoolClient,
  jobId: string,
  status: string,
  message: string,
  metadata: Record<string, unknown>,
) {
  await client.query(
    'INSERT INTO "ProvisioningJobEvent" (id,"jobId",status,message,metadata,"createdAt") VALUES ($1,$2,$3::"ProvisioningJobStatus",$4,$5::jsonb,NOW())',
    [randomUUID(), jobId, status, message, JSON.stringify(metadata)],
  );
}

async function writeAudit(
  client: PoolClient,
  input: {
    actorId: string;
    orgId: string;
    action: string;
    entityId: string;
    ip?: string | null;
    userAgent?: string | null;
    metadata: Record<string, unknown>;
  },
) {
  await client.query(
    'INSERT INTO "AuditLog" (id,"userId","orgId",action,"entityType","entityId",ip,"userAgent",metadata,"createdAt") VALUES ($1,$2,$3,$4,\'provisioning_job\',$5,$6,$7,$8::jsonb,NOW())',
    [
      randomUUID(),
      input.actorId,
      input.orgId,
      input.action,
      input.entityId,
      input.ip ?? null,
      input.userAgent ?? null,
      JSON.stringify(input.metadata),
    ],
  );
}

async function analyze(
  client: PoolClient,
  job: DeadJobRow,
  malformed: boolean,
  options: { includeHostingSuggestions?: boolean } = {},
) {
  const payload = asRecord(job.payload);
  const product = productLane(payload);
  const action = actionName(payload);
  const contract = recoveryContract(product, action);
  const sourceVerification = verifySource(job);
  const worker = await getProvisioningWorkerStatus();
  const paused = await provisioningPaused(client);
  const currentContext = safeContext(payload);
  const missingFields = contract.requiredFields.filter(
    (field) => !text(currentContext[field]),
  );

  let hostingCandidates: HostingRecoveryCandidate[] = [];
  let suggestionReason: string | null = null;
  if (
    options.includeHostingSuggestions &&
    product === "MIGRAHOSTING" &&
    contract.supported &&
    job.status === "DEAD" &&
    missingFields.length > 0
  ) {
    try {
      hostingCandidates = await getHostingRecoveryCandidates({
        orgName: job.orgName,
        orgSlug: job.orgSlug,
        limit: 5,
      });
      if (hostingCandidates.length === 0) {
        suggestionReason =
          "No MigraPanel tenant candidate matched this organization. Recovery context must be supplied manually or the organization must be linked from Hosting.";
      }
    } catch {
      suggestionReason =
        "MigraPanel recovery suggestions are temporarily unavailable. Manual audited recovery remains available.";
    }
  }

  let reason: string | null = null;
  if (job.status !== "DEAD") {
    reason = "Only DEAD provisioning jobs can enter dead-letter recovery.";
  } else if (malformed) {
    reason =
      "This legacy job was explicitly marked malformed. Create a fresh entitlement transition instead of replaying it.";
  } else if (!sourceVerification.payloadHashValid) {
    reason = "The original job payload hash no longer matches. Replay is blocked.";
  } else if (!sourceVerification.signatureValid) {
    reason =
      "The original job envelope does not verify under the active signing key. Replay is blocked; create a fresh transition.";
  } else if (paused) {
    reason = "Platform provisioning is currently paused.";
  } else if (!worker.ready) {
    reason = worker.reason ?? "The managed provisioning worker is unavailable.";
  } else if (!workerAllowsProduct(product)) {
    reason =
      "The managed provisioning worker is not configured to claim the " +
      (product ?? "unknown") +
      " product lane.";
  } else if (!contract.supported) {
    reason = contract.reason;
  }

  return {
    job: {
      id: job.id,
      orgId: job.orgId,
      orgName: job.orgName,
      orgSlug: job.orgSlug,
      source: job.source,
      type: job.type,
      status: job.status,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      lastError: job.lastError,
      createdAt: new Date(job.createdAt).toISOString(),
      updatedAt: new Date(job.updatedAt).toISOString(),
      productLane: product,
      action,
    },
    retry: {
      available: reason === null,
      reason,
      malformed,
      payloadHashValid: sourceVerification.payloadHashValid,
      signatureValid: sourceVerification.signatureValid,
      requiredFields: contract.requiredFields,
      requiredInputs: getProvisioningInputDescriptors(contract.requiredFields),
      missingFields,
      currentContext,
      hostingCandidates,
      suggestionReason,
      worker,
      provisioningPaused: paused,
    },
    cancel: {
      available: job.status === "DEAD",
    },
  };
}

export async function getDeadLetterRemediation(
  jobId: string,
  options: { includeHostingSuggestions?: boolean } = {},
) {
  const client = await getDb().connect();
  try {
    const job = await loadJob(client, jobId, false);
    if (!job) {
      throw Object.assign(new Error("Provisioning job not found"), { statusCode: 404 });
    }
    const malformed = await isMalformed(client, job.id);
    return analyze(client, job, malformed, options);
  } finally {
    client.release();
  }
}

function mergeRecoveryContext(
  sourcePayload: unknown,
  context: DeadLetterRecoveryContext,
  metadata: {
    sourceJobId: string;
    actorId: string;
    reason: string;
    recoveredAt: string;
  },
): Record<string, unknown> {
  const payload = { ...asRecord(sourcePayload) };

  for (const [key, value] of Object.entries(context)) {
    if (typeof value === "string") {
      const normalized = value.trim();
      if (normalized) payload[key] = normalized;
    }
  }

  // Dead-letter replay must never copy mailbox credentials or one-time secret
  // references from historical payloads. A fresh access transition must create
  // fresh secret material.
  delete payload.mailboxPassword;
  delete payload.mailboxSecretRef;
  payload.recoverySourceJobId = metadata.sourceJobId;
  payload.recoveryActorId = metadata.actorId;
  payload.recoveryReason = metadata.reason;
  payload.recoveredAt = metadata.recoveredAt;
  return payload;
}

export async function retryDeadProvisioningJob(input: {
  jobId: string;
  actorId: string;
  reason: string;
  context: DeadLetterRecoveryContext;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const client = await getDb().connect();
  try {
    await client.query("BEGIN");
    const job = await loadJob(client, input.jobId, true);
    if (!job) {
      throw Object.assign(new Error("Provisioning job not found"), { statusCode: 404 });
    }
    const malformed = await isMalformed(client, job.id);
    const remediation = await analyze(client, job, malformed);
    if (!remediation.retry.available) {
      throw Object.assign(
        new Error(remediation.retry.reason ?? "Dead-letter retry is not available"),
        { statusCode: 409 },
      );
    }

    const mergedPayload = mergeRecoveryContext(job.payload, input.context, {
      sourceJobId: job.id,
      actorId: input.actorId,
      reason: input.reason,
      recoveredAt: new Date().toISOString(),
    });
    const mergedContext = safeContext(mergedPayload);
    const stillMissing = remediation.retry.requiredFields.filter(
      (field) => !text(mergedContext[field]),
    );
    if (stillMissing.length > 0) {
      throw Object.assign(
        new Error("Missing required recovery context: " + stillMissing.join(", ")),
        { statusCode: 400 },
      );
    }

    const retryJobId = randomUUID();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);
    const payloadHash = hashCanonicalPayload(mergedPayload);
    const envelopeVersion = 1;
    const signature = signProvisioningEnvelope({
      jobId: retryJobId,
      orgId: job.orgId,
      type: job.type,
      payloadHash,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      envelopeVersion,
    });
    const idempotencyKey = "dead-letter-retry:" + job.id + ":1";

    await client.query(
      `INSERT INTO "ProvisioningJob"
       (id,"orgId","createdByActorId",source,type,status,attempts,"maxAttempts","notBefore",
        "lastError","lastErrorAt","lockedAt","lockedBy","startedAt","finishedAt",
        "idempotencyKey","envelopeVersion",payload,"payloadHash",signature,"expiresAt","createdAt","updatedAt")
       VALUES
       ($1,$2,$3,'MANUAL'::"ProvisioningJobSource",$4::"ProvisioningJobType",'PENDING'::"ProvisioningJobStatus",
        0,$5,NULL,NULL,NULL,NULL,NULL,NULL,NULL,$6,$7,$8::jsonb,$9,$10,$11,$12,$12)`,
      [
        retryJobId,
        job.orgId,
        input.actorId,
        job.type,
        Math.min(Math.max(job.maxAttempts || 5, 1), 20),
        idempotencyKey,
        envelopeVersion,
        JSON.stringify(mergedPayload),
        payloadHash,
        signature,
        expiresAt,
        createdAt,
      ],
    );

    await appendEvent(client, retryJobId, "PENDING", "queued_from_dead_letter", {
      sourceJobId: job.id,
      operatorActorId: input.actorId,
      operatorReason: input.reason,
    });

    await client.query(
      'UPDATE "ProvisioningJob" SET status=\'CANCELED\'::"ProvisioningJobStatus","lockedAt"=NULL,"lockedBy"=NULL,"finishedAt"=COALESCE("finishedAt",NOW()),"updatedAt"=NOW() WHERE id=$1 AND status=\'DEAD\'::"ProvisioningJobStatus"',
      [job.id],
    );
    await appendEvent(client, job.id, "CANCELED", "dead_letter_retry_queued", {
      retryJobId,
      operatorActorId: input.actorId,
      operatorReason: input.reason,
      previousError: job.lastError,
    });
    await writeAudit(client, {
      actorId: input.actorId,
      orgId: job.orgId,
      action: "PROVISIONING_DEAD_LETTER_RETRIED",
      entityId: job.id,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      metadata: {
        retryJobId,
        reason: input.reason,
        productLane: remediation.job.productLane,
        provisioningAction: remediation.job.action,
        requiredFields: remediation.retry.requiredFields,
      },
    });

    await client.query("COMMIT");
    return {
      sourceJobId: job.id,
      retryJobId,
      status: "PENDING",
      productLane: remediation.job.productLane,
      action: remediation.job.action,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function cancelDeadProvisioningJob(input: {
  jobId: string;
  actorId: string;
  reason: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const client = await getDb().connect();
  try {
    await client.query("BEGIN");
    const job = await loadJob(client, input.jobId, true);
    if (!job) {
      throw Object.assign(new Error("Provisioning job not found"), { statusCode: 404 });
    }
    if (job.status !== "DEAD") {
      throw Object.assign(new Error("Only DEAD provisioning jobs can be canceled from the dead-letter queue"), {
        statusCode: 409,
      });
    }

    await client.query(
      'UPDATE "ProvisioningJob" SET status=\'CANCELED\'::"ProvisioningJobStatus","lockedAt"=NULL,"lockedBy"=NULL,"finishedAt"=COALESCE("finishedAt",NOW()),"updatedAt"=NOW() WHERE id=$1',
      [job.id],
    );
    await appendEvent(client, job.id, "CANCELED", "dead_letter_canceled", {
      operatorActorId: input.actorId,
      operatorReason: input.reason,
      previousError: job.lastError,
    });
    await writeAudit(client, {
      actorId: input.actorId,
      orgId: job.orgId,
      action: "PROVISIONING_DEAD_LETTER_CANCELED",
      entityId: job.id,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      metadata: {
        reason: input.reason,
        previousError: job.lastError,
        source: job.source,
        type: job.type,
      },
    });

    await client.query("COMMIT");
    return { jobId: job.id, status: "CANCELED" };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
