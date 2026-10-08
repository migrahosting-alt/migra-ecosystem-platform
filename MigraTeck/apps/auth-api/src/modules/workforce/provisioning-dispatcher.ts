import { randomUUID } from "node:crypto";
import * as jose from "jose";

import { config } from "../../config/env.js";
import { db } from "../../lib/db.js";
import type { WorkforceProduct } from "../../prisma-client.js";
import { reconcileExpiredWorkforceProductAccess } from "./expiry-reconciliation.js";

const DELIVERY_TIMEOUT_MS = 5_000;
const DELIVERY_LEASE_MS = 15_000;
const ASSERTION_TTL_SECONDS = 60;
const MAX_BACKOFF_SECONDS = 300;
const WORKER_ID = `migraauth:${process.pid}:${randomUUID()}`;

type ProvisioningTarget = {
  url: string;
  audience: string;
};

type ProvisioningEvent = Awaited<
  ReturnType<typeof db.workforceProvisioningOutbox.findFirst>
>;

type ClaimedProvisioningEvent = NonNullable<ProvisioningEvent> & {
  leaseOwner: string;
  leaseExpiresAt: Date;
};

let importedKey: Promise<jose.CryptoKey> | null = null;

function targetForProduct(product: WorkforceProduct): ProvisioningTarget | null {
  if (product !== "FRENDELO") return null;
  const url = config.workforceProvisioning.frendelo.url?.trim();
  if (!url) return null;
  return {
    url,
    audience: config.workforceProvisioning.frendelo.audience,
  };
}

export function validateWorkforceProvisioningConfig(): void {
  if (!config.workforceProvisioning.enabled) return;

  if (!config.workforceProvisioning.privateKey) {
    throw new Error(
      "AUTH_WORKFORCE_PROVISIONING_ENABLED=true requires a dedicated Ed25519 private key.",
    );
  }
  if (!config.workforceProvisioning.keyId?.trim()) {
    throw new Error(
      "AUTH_WORKFORCE_PROVISIONING_ENABLED=true requires AUTH_WORKFORCE_PROVISIONING_KEY_ID.",
    );
  }
  if (!config.workforceProvisioning.frendelo.url?.trim()) {
    throw new Error(
      "AUTH_WORKFORCE_PROVISIONING_ENABLED=true requires AUTH_WORKFORCE_PROVISIONING_FRENDELO_URL.",
    );
  }
  if (
    !Number.isInteger(config.workforceProvisioning.intervalMs) ||
    config.workforceProvisioning.intervalMs < 250
  ) {
    throw new Error(
      "AUTH_WORKFORCE_PROVISIONING_INTERVAL_MS must be an integer >= 250.",
    );
  }
  if (
    !Number.isInteger(config.workforceProvisioning.batchSize) ||
    config.workforceProvisioning.batchSize < 1 ||
    config.workforceProvisioning.batchSize > 250
  ) {
    throw new Error(
      "AUTH_WORKFORCE_PROVISIONING_BATCH_SIZE must be an integer from 1 to 250.",
    );
  }
}

async function signingKey(): Promise<jose.CryptoKey> {
  if (!importedKey) {
    importedKey = jose.importPKCS8(
      config.workforceProvisioning.privateKey!,
      "EdDSA",
    );
  }
  return importedKey;
}

export async function signWorkforceProvisioningAssertion(
  event: NonNullable<ProvisioningEvent>,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const target = targetForProduct(event.product);
  if (!target) throw new Error("product_target_unconfigured");

  return new jose.SignJWT({
    event_id: event.id,
    event_type: event.eventType,
    product: event.product.toLowerCase(),
    staff_id: event.staffId,
    entitlement_revision: event.entitlementRevision,
    product_access_active: event.productAccessActive,
    product_roles: event.roleKeys,
    product_grant_ids: event.grantIds,
  })
    .setProtectedHeader({
      alg: "EdDSA",
      typ: "JWT",
      kid: config.workforceProvisioning.keyId!,
    })
    .setIssuer(config.workforceProvisioning.issuer)
    .setAudience(target.audience)
    .setSubject(event.staffId)
    .setJti(randomUUID())
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + ASSERTION_TTL_SECONDS)
    .sign(await signingKey());
}

function safeFailureCode(error: unknown): string {
  if (
    error instanceof DOMException &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  ) {
    return "delivery_timeout";
  }
  if (error instanceof Error && error.message === "product_target_unconfigured") {
    return error.message;
  }
  return "delivery_failed";
}

function retryDelaySeconds(attempt: number): number {
  return Math.min(
    MAX_BACKOFF_SECONDS,
    Math.max(2, 2 ** Math.min(Math.max(attempt, 1), 8)),
  );
}

async function markDelivered(
  event: ClaimedProvisioningEvent,
): Promise<boolean> {
  const deliveredAt = new Date();
  return db.$transaction(async (tx) => {
    const updated = await tx.workforceProvisioningOutbox.updateMany({
      where: {
        id: event.id,
        deliveredAt: null,
        leaseOwner: event.leaseOwner,
      },
      data: {
        deliveredAt,
        attemptCount: { increment: 1 },
        lastError: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
    if (updated.count !== 1) return false;

    const newer = await tx.workforceProvisioningOutbox.count({
      where: {
        workforceProfileId: event.workforceProfileId,
        product: event.product,
        entitlementRevision: { gt: event.entitlementRevision },
      },
    });

    if (newer === 0 && event.relatedGrantIds.length > 0) {
      await tx.workforceProductAccessGrant.updateMany({
        where: {
          workforceProfileId: event.workforceProfileId,
          id: { in: event.relatedGrantIds },
        },
        data: {
          provisioningState: "SYNCED",
          lastProvisionedAt: deliveredAt,
          lastProvisionError: null,
        },
      });
    }

    return true;
  });
}

async function markFailed(
  event: ClaimedProvisioningEvent,
  reason: string,
): Promise<boolean> {
  const attempt = event.attemptCount + 1;
  const now = new Date();
  const nextAttemptAt = new Date(
    now.getTime() + retryDelaySeconds(attempt) * 1000,
  );
  const safeReason = reason.slice(0, 1000);

  return db.$transaction(async (tx) => {
    const updated = await tx.workforceProvisioningOutbox.updateMany({
      where: {
        id: event.id,
        deliveredAt: null,
        leaseOwner: event.leaseOwner,
      },
      data: {
        attemptCount: { increment: 1 },
        nextAttemptAt,
        lastError: safeReason,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
    if (updated.count !== 1) return false;

    const newer = await tx.workforceProvisioningOutbox.count({
      where: {
        workforceProfileId: event.workforceProfileId,
        product: event.product,
        entitlementRevision: { gt: event.entitlementRevision },
      },
    });

    if (newer === 0 && event.relatedGrantIds.length > 0) {
      await tx.workforceProductAccessGrant.updateMany({
        where: {
          workforceProfileId: event.workforceProfileId,
          id: { in: event.relatedGrantIds },
        },
        data: {
          provisioningState: "ERROR",
          lastProvisionError: safeReason,
        },
      });
    }

    return true;
  });
}

export async function deliverWorkforceProvisioningEvent(
  event: ClaimedProvisioningEvent,
  fetchImpl: typeof fetch = fetch,
): Promise<"delivered" | "failed"> {
  const target = targetForProduct(event.product);
  if (!target) {
    await markFailed(event, "product_target_unconfigured");
    return "failed";
  }

  try {
    const assertion = await signWorkforceProvisioningAssertion(event);
    const response = await fetchImpl(target.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assertion }),
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });

    if (!response.ok) {
      await markFailed(event, `receiver_http_${response.status}`);
      return "failed";
    }

    const marked = await markDelivered(event);
    return marked ? "delivered" : "failed";
  } catch (error) {
    await markFailed(event, safeFailureCode(error));
    return "failed";
  }
}

async function claimPendingWorkforceProvisioning(): Promise<
  ClaimedProvisioningEvent[]
> {
  const now = new Date();
  const candidates = await db.workforceProvisioningOutbox.findMany({
    where: {
      deliveredAt: null,
      nextAttemptAt: { lte: now },
      product: "FRENDELO",
      OR: [
        { leaseExpiresAt: null },
        { leaseExpiresAt: { lte: now } },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: Math.max(
      config.workforceProvisioning.batchSize,
      config.workforceProvisioning.batchSize * 2,
    ),
  });

  const claimed: ClaimedProvisioningEvent[] = [];
  for (const candidate of candidates) {
    if (claimed.length >= config.workforceProvisioning.batchSize) break;

    const leaseExpiresAt = new Date(Date.now() + DELIVERY_LEASE_MS);
    const claim = await db.workforceProvisioningOutbox.updateMany({
      where: {
        id: candidate.id,
        deliveredAt: null,
        nextAttemptAt: { lte: now },
        OR: [
          { leaseExpiresAt: null },
          { leaseExpiresAt: { lte: now } },
        ],
      },
      data: {
        leaseOwner: WORKER_ID,
        leaseExpiresAt,
      },
    });

    if (claim.count !== 1) continue;
    claimed.push({
      ...candidate,
      leaseOwner: WORKER_ID,
      leaseExpiresAt,
    });
  }

  return claimed;
}

export async function dispatchPendingWorkforceProvisioning(): Promise<{
  attempted: number;
  delivered: number;
  failed: number;
}> {
  if (!config.workforceProvisioning.enabled) {
    return { attempted: 0, delivered: 0, failed: 0 };
  }

  const events = await claimPendingWorkforceProvisioning();

  let delivered = 0;
  let failed = 0;
  for (const event of events) {
    const result = await deliverWorkforceProvisioningEvent(event);
    if (result === "delivered") delivered += 1;
    else failed += 1;
  }

  return { attempted: events.length, delivered, failed };
}

export function startWorkforceProvisioningWorker(
  log: Pick<Console, "info" | "warn" | "error"> = console,
): () => void {
  validateWorkforceProvisioningConfig();
  if (!config.workforceProvisioning.enabled) {
    log.info(
      "[workforce-provisioning] worker disabled; no delivery or expiry reconciliation scheduled",
    );
    return () => {};
  }

  let stopped = false;
  let running = false;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const expiry = await reconcileExpiredWorkforceProductAccess();
      if (
        expiry.grantsExpired > 0 ||
        expiry.conflicts > 0 ||
        expiry.protectedFinalAdmins > 0
      ) {
        log.info(
          `[workforce-expiry] expired=${expiry.grantsExpired} conflicts=${expiry.conflicts} protected_final_admins=${expiry.protectedFinalAdmins}`,
        );
      }

      const result = await dispatchPendingWorkforceProvisioning();
      if (result.attempted > 0) {
        log.info(
          `[workforce-provisioning] attempted=${result.attempted} delivered=${result.delivered} failed=${result.failed}`,
        );
      }
    } catch {
      // Deliberately log only a stable reason code; assertions and key material
      // must never enter logs.
      log.error("[workforce-provisioning] worker_tick_failed");
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(tick, config.workforceProvisioning.intervalMs);
  timer.unref?.();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
