import { EntitlementStatus, ProvisioningJobSource } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { getPlatformConfig } from "@/lib/platform-config";
import { queueProvisioningForEntitlementTransition } from "@/lib/provisioning/queue";
import { prisma } from "@/lib/prisma";

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;
export async function transitionExpiredEntitlements(now = new Date()): Promise<number> {
  const config = await getPlatformConfig();
  if (config.maintenanceMode || config.pauseEntitlementExpiryWorker) {
    await writeAuditLog({
      action: "ENTITLEMENT_EXPIRY_WORKER_HEARTBEAT",
      resourceType: "worker",
      resourceId: "entitlement-expiry",
      riskTier: 0,
      metadata: {
        skipped: true,
        maintenanceMode: config.maintenanceMode,
        pauseEntitlementExpiryWorker: config.pauseEntitlementExpiryWorker,
      },
    });

    return 0;
  }

  const expired = await prisma.orgEntitlement.findMany({
    where: {
      status: {
        in: [EntitlementStatus.TRIAL, EntitlementStatus.ACTIVE],
      },
      endsAt: {
        lt: now,
      },
    },
    select: {
      id: true,
      orgId: true,
      product: true,
      status: true,
      startsAt: true,
      endsAt: true,
      notes: true,
    },
    take: 500,
  });

  for (const entitlement of expired) {
    const updated = await prisma.orgEntitlement.updateMany({
      where: {
        id: entitlement.id,
        status: entitlement.status,
      },
      data: {
        status: EntitlementStatus.RESTRICTED,
        notes: `${entitlement.notes ? `${entitlement.notes}\n` : ""}Auto-downgraded at ${now.toISOString()} due to expiry.`,
      },
    });

    if (updated.count !== 1) {
      continue;
    }

    await writeAuditLog({
      orgId: entitlement.orgId,
      action: "ORG_ENTITLEMENT_AUTO_RESTRICTED",
      resourceType: "org_entitlement",
      resourceId: entitlement.product,
      riskTier: 2,
      metadata: {
        product: entitlement.product,
        previousStatus: entitlement.status,
        newStatus: EntitlementStatus.RESTRICTED,
        startsAt: entitlement.startsAt,
        endsAt: entitlement.endsAt,
      },
    });

    const org = await prisma.organization.findUnique({
      where: { id: entitlement.orgId },
      select: { slug: true },
    });

    await queueProvisioningForEntitlementTransition({
      orgId: entitlement.orgId,
      orgSlug: org?.slug || "",
      product: entitlement.product,
      previousStatus: entitlement.status,
      newStatus: EntitlementStatus.RESTRICTED,
      source: ProvisioningJobSource.ENTITLEMENT_EXPIRY,
      transitionId: `expiry:${entitlement.id}:${now.toISOString()}`,
    });
  }

  await writeAuditLog({
    action: "ENTITLEMENT_EXPIRY_WORKER_HEARTBEAT",
    resourceType: "worker",
    resourceId: "entitlement-expiry",
    riskTier: 0,
    metadata: {
      processed: expired.length,
      timestamp: now.toISOString(),
    },
  });

  return expired.length;
}

export async function runEntitlementExpiryOnce(): Promise<void> {
  await transitionExpiredEntitlements(new Date());
}

export function startEntitlementExpiryWorker(intervalMs = DEFAULT_INTERVAL_MS): NodeJS.Timeout {
  const handle = setInterval(() => {
    void runEntitlementExpiryOnce().catch((error) => {
      console.error("entitlement-expiry worker iteration failed", error);
    });
  }, intervalMs);

  return handle;
}

if (process.env.RUN_ENTITLEMENT_EXPIRY_WORKER === "true") {
  void runEntitlementExpiryOnce().catch((error) => {
    console.error("entitlement-expiry startup failed", error);
    process.exitCode = 1;
  });

  startEntitlementExpiryWorker();
}
