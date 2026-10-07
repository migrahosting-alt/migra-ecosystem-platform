import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getDb } from "./db.js";
import {
  getEntitlementTransitionAvailability,
  type EntitlementTransitionAvailability,
} from "./commerce-entitlements.js";
import {
  hashCanonicalPayload,
  signProvisioningEnvelope,
} from "./provisioning-crypto.js";
import { publishPlatformEvent } from "./platform-events.js";
import type {
  EntitlementStatus,
  ProductKey,
} from "./commerce-catalog.js";

type ExpiredEntitlement = {
  id: string;
  orgId: string;
  orgSlug: string;
  product: ProductKey;
  status: EntitlementStatus;
  startsAt: Date | null;
  endsAt: Date;
  notes: string | null;
  updatedAt: Date;
};

type ProvisioningAction = EntitlementTransitionAvailability["actions"][number];

export type EntitlementExpiryResult = {
  scanned: number;
  restricted: number;
  queuedJobs: number;
  skippedProvisioning: number;
  paused: boolean;
};

function defaultBatchSize(): number {
  const value = Number(process.env.ENTITLEMENT_EXPIRY_BATCH_SIZE ?? 100);
  return Number.isFinite(value) && value > 0
    ? Math.min(Math.floor(value), 500)
    : 100;
}

function defaultMaxAttempts(): number {
  const value = Number(process.env.PROVISIONING_JOB_DEFAULT_MAX_ATTEMPTS ?? 5);
  return Number.isFinite(value) && value > 0
    ? Math.min(Math.floor(value), 20)
    : 5;
}

function jobTypeForAction(action: ProvisioningAction): "SCALE" | "RESTRICT" {
  return action === "POD_SCALE_DOWN" ? "SCALE" : "RESTRICT";
}

async function expiryPaused(): Promise<boolean> {
  const result = await getDb().query<{
    maintenanceMode: boolean;
    pauseEntitlementExpiryWorker: boolean;
  }>(
    "SELECT \"maintenanceMode\",\"pauseEntitlementExpiryWorker\" FROM \"PlatformConfig\" WHERE id='default' LIMIT 1",
  );
  const row = result.rows[0];
  return Boolean(row?.maintenanceMode || row?.pauseEntitlementExpiryWorker);
}

async function writeAudit(
  client: Pick<PoolClient, "query">,
  input: {
    orgId?: string | null;
    action: string;
    entityId: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    "INSERT INTO \"AuditLog\" (id,\"userId\",\"orgId\",action,\"entityType\",\"entityId\",metadata,\"createdAt\") VALUES ($1,NULL,$2,$3,'org_entitlement',$4,$5::jsonb,NOW())",
    [
      randomUUID(),
      input.orgId ?? null,
      input.action,
      input.entityId,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

async function claimAndRestrict(
  entitlementId: string,
  now: Date,
): Promise<ExpiredEntitlement | null> {
  const client = await getDb().connect();
  try {
    await client.query("BEGIN");

    const result = await client.query<ExpiredEntitlement>(
      "SELECT e.id,e.\"orgId\",o.slug AS \"orgSlug\",e.product::text AS product,e.status::text AS status,e.\"startsAt\",e.\"endsAt\",e.notes,e.\"updatedAt\" FROM \"OrgEntitlement\" e JOIN \"Organization\" o ON o.id=e.\"orgId\" WHERE e.id=$1 AND e.status::text = ANY($2::text[]) AND e.\"endsAt\" IS NOT NULL AND e.\"endsAt\" < $3 FOR UPDATE OF e",
      [entitlementId, ["ACTIVE", "TRIAL"], now],
    );
    const entitlement = result.rows[0];
    if (!entitlement) {
      await client.query("COMMIT");
      return null;
    }

    const note =
      (entitlement.notes ? entitlement.notes + "\n" : "") +
      "Auto-restricted at " +
      now.toISOString() +
      " because the entitlement expired.";

    await client.query(
      "UPDATE \"OrgEntitlement\" SET status='RESTRICTED'::\"EntitlementStatus\",notes=$2,\"updatedAt\"=NOW() WHERE id=$1",
      [entitlement.id, note],
    );

    await writeAudit(client, {
      orgId: entitlement.orgId,
      action: "ORG_ENTITLEMENT_AUTO_RESTRICTED",
      entityId: entitlement.id,
      metadata: {
        product: entitlement.product,
        previousStatus: entitlement.status,
        newStatus: "RESTRICTED",
        startsAt: entitlement.startsAt,
        endsAt: entitlement.endsAt,
        expiredAt: now.toISOString(),
      },
    });

    await publishPlatformEvent(client, {
      eventType: "entitlement.revoked",
      source: "migrateck-entitlement-expiry-worker",
      orgId: entitlement.orgId,
      entityType: "org_entitlement",
      entityId: entitlement.id,
      payload: {
        product: entitlement.product,
        previous_status: entitlement.status,
        status: "RESTRICTED",
        starts_at: entitlement.startsAt,
        ends_at: entitlement.endsAt,
        expiry_enforced_at: now.toISOString(),
      },
    });

    await client.query("COMMIT");
    return entitlement;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function queueRestrictionAction(
  entitlement: ExpiredEntitlement,
  action: ProvisioningAction,
  transitionId: string,
): Promise<string> {
  const client = await getDb().connect();
  const jobId = randomUUID();
  const taskId = randomUUID();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);
  const type = jobTypeForAction(action);
  const payload = {
    jobId,
    action,
    product: entitlement.product,
    productLane: entitlement.product,
    previousStatus: entitlement.status,
    newStatus: "RESTRICTED",
    intent: "entitlement_expiry",
    transitionId,
    entitlementId: entitlement.id,
    entitlementEndsAt: entitlement.endsAt.toISOString(),
  };
  const payloadHash = hashCanonicalPayload(payload);
  const envelopeVersion = 1;
  const signature = signProvisioningEnvelope({
    jobId,
    orgId: entitlement.orgId,
    type,
    payloadHash,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    envelopeVersion,
  });
  const idempotencyKey =
    "entitlement-expiry:" +
    entitlement.id +
    ":" +
    entitlement.endsAt.toISOString() +
    ":" +
    action;

  try {
    await client.query("BEGIN");

    const existing = await client.query<{ id: string }>(
      "SELECT id FROM \"ProvisioningJob\" WHERE \"idempotencyKey\"=$1 LIMIT 1",
      [idempotencyKey],
    );
    if (existing.rows[0]) {
      await client.query("COMMIT");
      return existing.rows[0].id;
    }

    await client.query(
      "INSERT INTO \"ProvisioningTask\" (id,\"orgId\",product,action,status,attempts,\"runAfter\",\"lastError\",payload,\"createdByUserId\",\"createdAt\",\"updatedAt\") VALUES ($1,$2,$3::\"ProductKey\",$4::\"ProvisioningAction\",'PENDING'::\"ProvisioningTaskStatus\",0,NULL,NULL,$5::jsonb,NULL,$6,$6)",
      [
        taskId,
        entitlement.orgId,
        entitlement.product,
        action,
        JSON.stringify(payload),
        createdAt,
      ],
    );

    await client.query(
      "INSERT INTO \"ProvisioningJob\" (id,\"orgId\",\"createdByActorId\",source,type,status,attempts,\"maxAttempts\",\"notBefore\",\"lastError\",\"lastErrorAt\",\"lockedAt\",\"lockedBy\",\"startedAt\",\"finishedAt\",\"idempotencyKey\",\"envelopeVersion\",payload,\"payloadHash\",signature,\"expiresAt\",\"createdAt\",\"updatedAt\") VALUES ($1,$2,NULL,'ENTITLEMENT_EXPIRY'::\"ProvisioningJobSource\",$3::\"ProvisioningJobType\",'PENDING'::\"ProvisioningJobStatus\",0,$4,NULL,NULL,NULL,NULL,NULL,NULL,NULL,$5,$6,$7::jsonb,$8,$9,$10,$11,$11)",
      [
        jobId,
        entitlement.orgId,
        type,
        defaultMaxAttempts(),
        idempotencyKey,
        envelopeVersion,
        JSON.stringify(payload),
        payloadHash,
        signature,
        expiresAt,
        createdAt,
      ],
    );

    await client.query(
      "INSERT INTO \"ProvisioningJobEvent\" (id,\"jobId\",status,message,metadata,\"createdAt\") VALUES ($1,$2,'PENDING'::\"ProvisioningJobStatus\",'queued_from_entitlement_expiry',$3::jsonb,$4)",
      [
        randomUUID(),
        jobId,
        JSON.stringify({
          source: "ENTITLEMENT_EXPIRY",
          action,
          product: entitlement.product,
          entitlementId: entitlement.id,
          transitionId,
          taskId,
        }),
        createdAt,
      ],
    );

    await writeAudit(client, {
      orgId: entitlement.orgId,
      action: "ENTITLEMENT_EXPIRY_PROVISIONING_QUEUED",
      entityId: entitlement.id,
      metadata: {
        product: entitlement.product,
        action,
        jobId,
        taskId,
        transitionId,
      },
    });

    await client.query("COMMIT");
    return jobId;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function queueSupportedRestriction(
  entitlement: ExpiredEntitlement,
): Promise<{ queued: number; skipped: boolean }> {
  const availability = await getEntitlementTransitionAvailability({
    orgSlug: entitlement.orgSlug,
    product: entitlement.product,
    previousStatus: entitlement.status,
    newStatus: "RESTRICTED",
  });

  if (
    !availability.available ||
    availability.mode !== "provisioning" ||
    availability.actions.length === 0 ||
    availability.requiredFields.length > 0
  ) {
    await writeAudit(getDb(), {
      orgId: entitlement.orgId,
      action: "ENTITLEMENT_EXPIRY_PROVISIONING_SKIPPED",
      entityId: entitlement.id,
      metadata: {
        product: entitlement.product,
        previousStatus: entitlement.status,
        actions: availability.actions,
        mode: availability.mode,
        available: availability.available,
        reason:
          availability.reason ??
          (availability.requiredFields.length > 0
            ? "automatic expiry does not guess provisioning context"
            : "no infrastructure action required"),
        requiredFields: availability.requiredFields,
      },
    });
    return {
      queued: 0,
      skipped:
        availability.actions.length > 0 ||
        availability.mode === "blocked",
    };
  }

  const transitionId =
    "expiry:" +
    entitlement.id +
    ":" +
    entitlement.endsAt.toISOString();
  let queued = 0;
  for (const action of availability.actions) {
    await queueRestrictionAction(entitlement, action, transitionId);
    queued += 1;
  }
  return { queued, skipped: false };
}

export async function transitionExpiredEntitlements(
  now = new Date(),
  batchSize = defaultBatchSize(),
): Promise<EntitlementExpiryResult> {
  if (await expiryPaused()) {
    return {
      scanned: 0,
      restricted: 0,
      queuedJobs: 0,
      skippedProvisioning: 0,
      paused: true,
    };
  }

  const candidates = await getDb().query<{ id: string }>(
    "SELECT id FROM \"OrgEntitlement\" WHERE status::text = ANY($1::text[]) AND \"endsAt\" IS NOT NULL AND \"endsAt\" < $2 ORDER BY \"endsAt\" ASC LIMIT $3",
    [["ACTIVE", "TRIAL"], now, Math.min(Math.max(batchSize, 1), 500)],
  );

  let restricted = 0;
  let queuedJobs = 0;
  let skippedProvisioning = 0;

  for (const candidate of candidates.rows) {
    const entitlement = await claimAndRestrict(candidate.id, now);
    if (!entitlement) continue;
    restricted += 1;

    try {
      const result = await queueSupportedRestriction(entitlement);
      queuedJobs += result.queued;
      if (result.skipped) skippedProvisioning += 1;
    } catch (error) {
      skippedProvisioning += 1;
      await writeAudit(getDb(), {
        orgId: entitlement.orgId,
        action: "ENTITLEMENT_EXPIRY_PROVISIONING_FAILED",
        entityId: entitlement.id,
        metadata: {
          product: entitlement.product,
          message:
            error instanceof Error
              ? error.message
              : "unknown provisioning queue error",
        },
      });
    }
  }

  return {
    scanned: candidates.rows.length,
    restricted,
    queuedJobs,
    skippedProvisioning,
    paused: false,
  };
}
