import { db } from "../../lib/db.js";
import type { WorkforceProduct } from "../../prisma-client.js";
import {
  activeProductSnapshot,
  enqueueWorkforceProvisioningSnapshot,
  supportsWorkforceProvisioning,
} from "./provisioning-outbox.js";

type DueGroup = {
  workforceProfileId: string;
  product: WorkforceProduct;
};

function groupDue(
  rows: Array<{ workforceProfileId: string; product: WorkforceProduct }>,
): DueGroup[] {
  const unique = new Map<string, DueGroup>();
  for (const row of rows) {
    unique.set(`${row.workforceProfileId}:${row.product}`, row);
  }
  return [...unique.values()];
}

export async function reconcileExpiredWorkforceProductAccess(
  limit = 100,
): Promise<{
  groupsAttempted: number;
  grantsExpired: number;
  conflicts: number;
  protectedFinalAdmins: number;
}> {
  const now = new Date();
  const due = await db.workforceProductAccessGrant.findMany({
    where: {
      revokedAt: null,
      expiresAt: { lte: now },
    },
    orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
    take: Math.max(1, Math.min(limit, 500)),
    select: {
      workforceProfileId: true,
      product: true,
    },
  });

  let grantsExpired = 0;
  let conflicts = 0;
  let protectedFinalAdmins = 0;
  const groups = groupDue(due);

  for (const group of groups) {
    try {
      const result = await db.$transaction(
        async (tx) => {
          const profile = await tx.workforceProfile.findUnique({
            where: { id: group.workforceProfileId },
            include: {
              user: { select: { status: true } },
            },
          });
          if (!profile) return { expired: 0, protectedFinalAdmin: false };

          const expired = await tx.workforceProductAccessGrant.findMany({
            where: {
              workforceProfileId: profile.id,
              product: group.product,
              revokedAt: null,
              expiresAt: { lte: now },
            },
            select: { id: true, roleKey: true },
          });
          if (expired.length === 0) {
            return { expired: 0, protectedFinalAdmin: false };
          }

          const expiredIds = expired.map((grant) => grant.id);
          if (
            group.product === "FRENDELO" &&
            expired.some((grant) => grant.roleKey === "super_admin")
          ) {
            const otherSuperAdmins =
              await tx.workforceProductAccessGrant.count({
                where: {
                  id: { notIn: expiredIds },
                  product: "FRENDELO",
                  roleKey: "super_admin",
                  revokedAt: null,
                  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
                  workforceProfile: {
                    employmentStatus: "ACTIVE",
                    user: { status: "ACTIVE" },
                  },
                },
              });
            if (otherSuperAdmins === 0) {
              return { expired: 0, protectedFinalAdmin: true };
            }
          }

          const revoked = await tx.workforceProductAccessGrant.updateMany({
            where: {
              id: { in: expiredIds },
              workforceProfileId: profile.id,
              product: group.product,
              revokedAt: null,
            },
            data: {
              revokedAt: now,
              provisioningState: "PENDING",
              revision: { increment: 1 },
            },
          });
          if (revoked.count !== expired.length) {
            throw Object.assign(new Error("expiry_change_conflict"), {
              code: "P2034",
            });
          }

          const revised = await tx.workforceProfile.update({
            where: { id: profile.id },
            data: { entitlementRevision: { increment: 1 } },
            select: { entitlementRevision: true },
          });

          const snapshot = await activeProductSnapshot(tx, {
            workforceProfileId: profile.id,
            product: group.product,
            now,
          });
          const accessActive =
            profile.employmentStatus === "ACTIVE" &&
            profile.user.status === "ACTIVE" &&
            snapshot.roleKeys.length > 0;
          const event = supportsWorkforceProvisioning(group.product)
            ? await enqueueWorkforceProvisioningSnapshot(tx, {
                workforceProfileId: profile.id,
                staffId: profile.staffId,
                product: group.product,
                eventType: "expire",
                entitlementRevision: revised.entitlementRevision,
                productAccessActive: accessActive,
                roleKeys: snapshot.roleKeys,
                grantIds: snapshot.grantIds,
                relatedGrantIds: expiredIds,
              })
            : null;

          await tx.auditLog.create({
            data: {
              actorUserId: null,
              actorType: "SYSTEM",
              targetUserId: profile.userId,
              eventType: "WORKFORCE_PRODUCT_ACCESS_EXPIRED",
              eventData: {
                staff_id: profile.staffId,
                product: group.product.toLowerCase(),
                expired_grant_ids: expiredIds.sort(),
                expired_role_keys: Array.from(
                  new Set(expired.map((grant) => grant.roleKey)),
                ).sort(),
                entitlement_revision: revised.entitlementRevision,
                provisioning_event_id: event?.id ?? null,
                reconciliation_source: "scheduler",
              },
            },
          });

          return {
            expired: revoked.count,
            protectedFinalAdmin: false,
          };
        },
        { isolationLevel: "Serializable" },
      );

      grantsExpired += result.expired;
      if (result.protectedFinalAdmin) protectedFinalAdmins += 1;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "P2034"
      ) {
        conflicts += 1;
        continue;
      }
      throw error;
    }
  }

  return {
    groupsAttempted: groups.length,
    grantsExpired,
    conflicts,
    protectedFinalAdmins,
  };
}
