import { randomUUID } from "node:crypto";
import { db } from "../../lib/db.js";
import type {
  WorkforceEmploymentType,
  WorkforceProduct,
} from "../../prisma-client.js";
import {
  activeProductSnapshot,
  activeProvisionedProductSnapshots,
  enqueueWorkforceProvisioningSnapshot,
} from "./provisioning-outbox.js";

export class WorkforceError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "WorkforceError";
  }
}

function newStaffId(): string {
  return `mt_staff_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export async function listWorkforce(input: {
  q?: string;
  limit?: number;
  offset?: number;
}) {
  const q = input.q?.trim();
  const now = new Date();
  const where = q
    ? {
        OR: [
          { staffId: { contains: q, mode: "insensitive" as const } },
          { jobTitle: { contains: q, mode: "insensitive" as const } },
          { department: { contains: q, mode: "insensitive" as const } },
          { team: { contains: q, mode: "insensitive" as const } },
          { user: { email: { contains: q, mode: "insensitive" as const } } },
          {
            user: {
              displayName: { contains: q, mode: "insensitive" as const },
            },
          },
        ],
      }
    : {};

  const [profiles, total] = await Promise.all([
    db.workforceProfile.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: input.limit ?? 50,
      skip: input.offset ?? 0,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            status: true,
            lastLoginAt: true,
          },
        },
        manager: { select: { staffId: true } },
        productAccess: {
          where: {
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          orderBy: [{ product: "asc" }, { roleKey: "asc" }],
        },
      },
    }),
    db.workforceProfile.count({ where }),
  ]);

  return { profiles, total };
}

export async function getWorkforceByStaffId(staffId: string) {
  return db.workforceProfile.findUnique({
    where: { staffId },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          displayName: true,
          status: true,
          lastLoginAt: true,
          emailVerifiedAt: true,
        },
      },
      manager: { select: { staffId: true } },
      directReports: {
        select: { staffId: true, jobTitle: true, employmentStatus: true },
      },
      productAccess: {
        orderBy: { grantedAt: "desc" },
      },
    },
  });
}

export async function createWorkforceIdentity(input: {
  email: string;
  displayName?: string;
  employmentType: WorkforceEmploymentType;
  jobTitle?: string;
  department?: string;
  team?: string;
  managerStaffId?: string;
  startsAt?: Date;
  actorUserId: string;
  ipAddress?: string;
  userAgent?: string;
}) {
  const staffId = newStaffId();

  return db.$transaction(async (tx) => {
    let managerProfileId: string | null = null;
    if (input.managerStaffId) {
      const manager = await tx.workforceProfile.findUnique({
        where: { staffId: input.managerStaffId },
        select: { id: true, employmentStatus: true },
      });
      if (!manager || manager.employmentStatus === "TERMINATED") {
        throw new WorkforceError(
          "manager_not_found",
          400,
          "The selected manager is not an active workforce identity.",
        );
      }
      managerProfileId = manager.id;
    }

    const user = await tx.user.create({
      data: {
        email: input.email,
        displayName: input.displayName?.trim() || null,
        status: "PENDING",
      },
      select: { id: true, email: true, displayName: true, status: true },
    });

    await tx.userIdentifier.create({
      data: {
        userId: user.id,
        kind: "EMAIL",
        normalizedValue: input.email,
        displayValue: input.email,
        isPrimary: true,
        isVerified: false,
      },
    });

    const profile = await tx.workforceProfile.create({
      data: {
        userId: user.id,
        staffId,
        employmentStatus: "INVITED",
        employmentType: input.employmentType,
        jobTitle: input.jobTitle?.trim() || null,
        department: input.department?.trim() || null,
        team: input.team?.trim() || null,
        managerProfileId,
        startsAt: input.startsAt ?? null,
        createdByUserId: input.actorUserId,
        updatedByUserId: input.actorUserId,
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        actorType: "ADMIN",
        targetUserId: user.id,
        eventType: "WORKFORCE_STAFF_CREATED",
        eventData: {
          staff_id: staffId,
          employment_type: input.employmentType.toLowerCase(),
          department: input.department?.trim() || null,
          team: input.team?.trim() || null,
          job_title: input.jobTitle?.trim() || null,
          manager_staff_id: input.managerStaffId ?? null,
        },
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });

    return { user, profile };
  });
}

export async function activateInvitedWorkforce(userId: string): Promise<boolean> {
  const result = await db.workforceProfile.updateMany({
    where: { userId, employmentStatus: "INVITED" },
    data: {
      employmentStatus: "ACTIVE",
      startsAt: new Date(),
    },
  });
  return result.count === 1;
}

export async function grantWorkforceProductAccess(input: {
  staffId: string;
  product: WorkforceProduct;
  roleKey: string;
  reason: string;
  expiresAt?: Date;
  actorUserId: string;
  ipAddress?: string;
  userAgent?: string;
}) {
  const now = new Date();
  const roleKey = input.roleKey.trim().toLowerCase();

  if (
    input.product === "FRENDELO" &&
    roleKey === "super_admin" &&
    input.expiresAt
  ) {
    throw new WorkforceError(
      "frendelo_super_admin_must_be_permanent",
      409,
      "Frendelo Super Admin cannot expire automatically. Revoke it explicitly after another active Super Admin exists.",
    );
  }

  try {
    return await db.$transaction(async (tx) => {
      const profile = await tx.workforceProfile.findUnique({
        where: { staffId: input.staffId },
        select: {
          id: true,
          userId: true,
          employmentStatus: true,
        },
      });
      if (!profile) {
        throw new WorkforceError(
          "staff_not_found",
          404,
          "No workforce identity has that Staff ID.",
        );
      }
      if (profile.employmentStatus === "TERMINATED") {
        throw new WorkforceError(
          "staff_terminated",
          409,
          "Terminated staff cannot receive new product access.",
        );
      }

      const existing = await tx.workforceProductAccessGrant.findFirst({
        where: {
          workforceProfileId: profile.id,
          product: input.product,
          roleKey,
          revokedAt: null,
        },
        select: { id: true, expiresAt: true },
      });
      let supersededExpiredGrantId: string | null = null;
      if (existing) {
        if (!existing.expiresAt || existing.expiresAt > now) {
          throw new WorkforceError(
            "product_role_already_active",
            409,
            "That product role is already active for this staff identity.",
          );
        }
        const expired = await tx.workforceProductAccessGrant.updateMany({
          where: {
            id: existing.id,
            workforceProfileId: profile.id,
            revokedAt: null,
          },
          data: {
            revokedAt: now,
            revokedByUserId: input.actorUserId,
            provisioningState: "PENDING",
            revision: { increment: 1 },
          },
        });
        if (expired.count !== 1) {
          throw new WorkforceError(
            "product_access_change_conflict_retry",
            409,
            "Product access changed concurrently. Refresh and retry.",
          );
        }
        supersededExpiredGrantId = existing.id;
      }

      const grant = await tx.workforceProductAccessGrant.create({
        data: {
          workforceProfileId: profile.id,
          product: input.product,
          roleKey,
          grantedByUserId: input.actorUserId,
          expiresAt: input.expiresAt ?? null,
          reason: input.reason,
          provisioningState: "PENDING",
        },
      });
      const revision = await tx.workforceProfile.update({
        where: { id: profile.id },
        data: { entitlementRevision: { increment: 1 } },
        select: { entitlementRevision: true },
      });
      const provisioningSnapshot = await activeProductSnapshot(tx, {
        workforceProfileId: profile.id,
        product: input.product,
        now,
      });
      const provisioningEvent =
        await enqueueWorkforceProvisioningSnapshot(tx, {
          workforceProfileId: profile.id,
          staffId: input.staffId,
          product: input.product,
          eventType: "grant",
          entitlementRevision: revision.entitlementRevision,
          productAccessActive: provisioningSnapshot.roleKeys.length > 0,
          roleKeys: provisioningSnapshot.roleKeys,
          grantIds: provisioningSnapshot.grantIds,
          relatedGrantIds: [
            grant.id,
            ...(supersededExpiredGrantId
              ? [supersededExpiredGrantId]
              : []),
          ],
        });

      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          actorType: "ADMIN",
          targetUserId: profile.userId,
          eventType: "WORKFORCE_PRODUCT_ACCESS_GRANTED",
          eventData: {
            staff_id: input.staffId,
            grant_id: grant.id,
            product: input.product.toLowerCase(),
            role_key: roleKey,
            reason: input.reason,
            expires_at: input.expiresAt?.toISOString() ?? null,
            superseded_expired_grant_id: supersededExpiredGrantId,
            entitlement_revision: revision.entitlementRevision,
            provisioning_event_id: provisioningEvent?.id ?? null,
          },
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
        },
      });

      return {
        ...grant,
        entitlementRevision: revision.entitlementRevision,
        provisioningEventId: provisioningEvent?.id ?? null,
      };
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      throw new WorkforceError(
        "product_role_already_active",
        409,
        "That product role is already active for this staff identity.",
      );
    }
    throw error;
  }
}

export async function revokeWorkforceProductAccess(input: {
  staffId: string;
  grantId: string;
  reason: string;
  actorUserId: string;
  ipAddress?: string;
  userAgent?: string;
}) {
  const now = new Date();
  try {
    return await db.$transaction(async (tx) => {
    const profile = await tx.workforceProfile.findUnique({
      where: { staffId: input.staffId },
      select: { id: true, userId: true },
    });
    if (!profile) {
      throw new WorkforceError(
        "staff_not_found",
        404,
        "No workforce identity has that Staff ID.",
      );
    }

    const grant = await tx.workforceProductAccessGrant.findFirst({
      where: {
        id: input.grantId,
        workforceProfileId: profile.id,
        revokedAt: null,
      },
    });
    if (!grant) {
      throw new WorkforceError(
        "product_access_not_found",
        404,
        "That active product-access grant was not found.",
      );
    }

    if (grant.product === "FRENDELO" && grant.roleKey === "super_admin") {
      const otherSuperAdmins = await tx.workforceProductAccessGrant.count({
        where: {
          id: { not: grant.id },
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
        throw new WorkforceError(
          "cannot_revoke_last_frendelo_super_admin",
          409,
          "Grant Frendelo Super Admin to another active workforce identity before revoking the final parent assignment.",
        );
      }
    }

    const revoked = await tx.workforceProductAccessGrant.updateMany({
      where: { id: grant.id, revokedAt: null },
      data: {
        revokedAt: now,
        revokedByUserId: input.actorUserId,
        reason: input.reason,
        provisioningState: "PENDING",
        revision: { increment: 1 },
      },
    });
    if (revoked.count !== 1) {
      throw new WorkforceError(
        "product_access_change_conflict_retry",
        409,
        "Product access changed concurrently. Refresh and retry.",
      );
    }

    const revision = await tx.workforceProfile.update({
      where: { id: profile.id },
      data: { entitlementRevision: { increment: 1 } },
      select: { entitlementRevision: true },
    });
    const provisioningSnapshot = await activeProductSnapshot(tx, {
      workforceProfileId: profile.id,
      product: grant.product,
      now,
    });
    const provisioningEvent =
      await enqueueWorkforceProvisioningSnapshot(tx, {
        workforceProfileId: profile.id,
        staffId: input.staffId,
        product: grant.product,
        eventType: "revoke",
        entitlementRevision: revision.entitlementRevision,
        productAccessActive: provisioningSnapshot.roleKeys.length > 0,
        roleKeys: provisioningSnapshot.roleKeys,
        grantIds: provisioningSnapshot.grantIds,
        relatedGrantIds: [grant.id],
      });

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        actorType: "ADMIN",
        targetUserId: profile.userId,
        eventType: "WORKFORCE_PRODUCT_ACCESS_REVOKED",
        eventData: {
          staff_id: input.staffId,
          grant_id: grant.id,
          product: grant.product.toLowerCase(),
          role_key: grant.roleKey,
          reason: input.reason,
          entitlement_revision: revision.entitlementRevision,
          provisioning_event_id: provisioningEvent?.id ?? null,
        },
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });

    return {
      revoked: true,
      grantId: grant.id,
      entitlementRevision: revision.entitlementRevision,
      provisioningEventId: provisioningEvent?.id ?? null,
    };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2034"
    ) {
      throw new WorkforceError(
        "workforce_change_conflict_retry",
        409,
        "Workforce authority changed concurrently. Refresh and retry.",
      );
    }
    throw error;
  }
}

export async function suspendWorkforceIdentity(input: {
  staffId: string;
  reason: string;
  actorUserId: string;
  ipAddress?: string;
  userAgent?: string;
}) {
  try {
    return await db.$transaction(async (tx) => {
    const now = new Date();
    const profile = await tx.workforceProfile.findUnique({
      where: { staffId: input.staffId },
      include: { user: { select: { id: true, status: true } } },
    });
    if (!profile) {
      throw new WorkforceError(
        "staff_not_found",
        404,
        "No workforce identity has that Staff ID.",
      );
    }
    if (profile.userId === input.actorUserId) {
      throw new WorkforceError(
        "cannot_suspend_self",
        409,
        "You cannot suspend your own workforce identity.",
      );
    }
    if (profile.employmentStatus === "TERMINATED") {
      throw new WorkforceError(
        "staff_terminated",
        409,
        "Terminated staff cannot be suspended.",
      );
    }
    if (profile.employmentStatus !== "ACTIVE") {
      throw new WorkforceError(
        "staff_not_active",
        409,
        "Only an active workforce identity can be suspended.",
      );
    }

    const ownerGrant = await tx.platformRoleGrant.findFirst({
      where: { userId: profile.userId, role: "OWNER", revokedAt: null },
      select: { id: true },
    });
    if (ownerGrant) {
      const otherOwners = await tx.platformRoleGrant.count({
        where: {
          role: "OWNER",
          revokedAt: null,
          userId: { not: profile.userId },
          user: { status: "ACTIVE" },
        },
      });
      if (otherOwners === 0) {
        throw new WorkforceError(
          "cannot_suspend_last_owner",
          409,
          "This is the last active platform OWNER. Grant OWNER to another active staff identity first.",
        );
      }
    }

    const activeFrendeloSuperAdmin =
      await tx.workforceProductAccessGrant.findFirst({
        where: {
          workforceProfileId: profile.id,
          product: "FRENDELO",
          roleKey: "super_admin",
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { id: true },
      });
    if (activeFrendeloSuperAdmin) {
      const otherFrendeloSuperAdmins =
        await tx.workforceProductAccessGrant.count({
          where: {
            workforceProfileId: { not: profile.id },
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
      if (otherFrendeloSuperAdmins === 0) {
        throw new WorkforceError(
          "cannot_suspend_last_frendelo_super_admin",
          409,
          "Grant Frendelo Super Admin to another active workforce identity before suspending the final parent administrator.",
        );
      }
    }

    const provisioningSnapshots =
      await activeProvisionedProductSnapshots(tx, {
        workforceProfileId: profile.id,
        now,
      });

    const sessions = await tx.session.updateMany({
      where: { userId: profile.userId, revokedAt: null },
      data: { revokedAt: now },
    });
    const refreshTokens = await tx.oAuthRefreshToken.updateMany({
      where: { userId: profile.userId, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.user.update({
      where: { id: profile.userId },
      data: { status: "LOCKED", lockedAt: now },
    });
    const suspendedProfile = await tx.workforceProfile.update({
      where: { id: profile.id },
      data: {
        employmentStatus: "SUSPENDED",
        updatedByUserId: input.actorUserId,
        entitlementRevision: { increment: 1 },
      },
      select: { entitlementRevision: true },
    });
    const provisioningEventIds: string[] = [];
    for (const snapshot of provisioningSnapshots) {
      const event = await enqueueWorkforceProvisioningSnapshot(tx, {
        workforceProfileId: profile.id,
        staffId: input.staffId,
        product: snapshot.product,
        eventType: "suspend",
        entitlementRevision: suspendedProfile.entitlementRevision,
        productAccessActive: false,
        roleKeys: [],
        grantIds: [],
        relatedGrantIds: snapshot.grantIds,
      });
      if (event) provisioningEventIds.push(event.id);
    }

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        actorType: "ADMIN",
        targetUserId: profile.userId,
        eventType: "WORKFORCE_STAFF_SUSPENDED",
        eventData: {
          staff_id: input.staffId,
          reason: input.reason,
          revoked_sessions: sessions.count,
          revoked_refresh_tokens: refreshTokens.count,
          entitlement_revision: suspendedProfile.entitlementRevision,
          provisioning_event_ids: provisioningEventIds,
        },
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });

    return {
      suspended: true,
      staffId: input.staffId,
      revokedSessions: sessions.count,
      revokedRefreshTokens: refreshTokens.count,
      entitlementRevision: suspendedProfile.entitlementRevision,
      provisioningEventIds,
    };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2034"
    ) {
      throw new WorkforceError(
        "workforce_change_conflict_retry",
        409,
        "Workforce authority changed concurrently. Refresh and retry.",
      );
    }
    throw error;
  }
}

export async function reactivateWorkforceIdentity(input: {
  staffId: string;
  reason: string;
  actorUserId: string;
  ipAddress?: string;
  userAgent?: string;
}) {
  const now = new Date();
  try {
    return await db.$transaction(async (tx) => {
      const profile = await tx.workforceProfile.findUnique({
        where: { staffId: input.staffId },
        include: { user: { select: { id: true, status: true } } },
      });
      if (!profile) {
        throw new WorkforceError(
          "staff_not_found",
          404,
          "No workforce identity has that Staff ID.",
        );
      }
      if (profile.employmentStatus === "TERMINATED") {
        throw new WorkforceError(
          "staff_terminated",
          409,
          "Terminated staff cannot be reactivated.",
        );
      }
      if (
        profile.employmentStatus !== "SUSPENDED" ||
        profile.user.status !== "LOCKED"
      ) {
        throw new WorkforceError(
          "staff_not_suspended",
          409,
          "Only a suspended workforce identity can be reactivated.",
        );
      }

      await tx.user.update({
        where: { id: profile.userId },
        data: { status: "ACTIVE", lockedAt: null },
      });
      const reactivated = await tx.workforceProfile.update({
        where: { id: profile.id },
        data: {
          employmentStatus: "ACTIVE",
          updatedByUserId: input.actorUserId,
          entitlementRevision: { increment: 1 },
        },
        select: { entitlementRevision: true },
      });

      const provisioningSnapshots =
        await activeProvisionedProductSnapshots(tx, {
          workforceProfileId: profile.id,
          now,
        });
      const provisioningEventIds: string[] = [];
      for (const snapshot of provisioningSnapshots) {
        const event = await enqueueWorkforceProvisioningSnapshot(tx, {
          workforceProfileId: profile.id,
          staffId: input.staffId,
          product: snapshot.product,
          eventType: "reactivate",
          entitlementRevision: reactivated.entitlementRevision,
          productAccessActive: snapshot.roleKeys.length > 0,
          roleKeys: snapshot.roleKeys,
          grantIds: snapshot.grantIds,
        });
        if (event) provisioningEventIds.push(event.id);
      }

      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          actorType: "ADMIN",
          targetUserId: profile.userId,
          eventType: "WORKFORCE_STAFF_REACTIVATED",
          eventData: {
            staff_id: input.staffId,
            reason: input.reason,
            entitlement_revision: reactivated.entitlementRevision,
            provisioning_event_ids: provisioningEventIds,
            session_reestablishment_required: true,
          },
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
        },
      });

      return {
        reactivated: true,
        staffId: input.staffId,
        entitlementRevision: reactivated.entitlementRevision,
        provisioningEventIds,
        sessionReestablishmentRequired: true,
      };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2034"
    ) {
      throw new WorkforceError(
        "workforce_change_conflict_retry",
        409,
        "Workforce authority changed concurrently. Refresh and retry.",
      );
    }
    throw error;
  }
}

export async function terminateWorkforceIdentity(input: {
  staffId: string;
  reason: string;
  actorUserId: string;
  ipAddress?: string;
  userAgent?: string;
}) {
  try {
    return await db.$transaction(async (tx) => {
    const now = new Date();
    const profile = await tx.workforceProfile.findUnique({
      where: { staffId: input.staffId },
      include: { user: { select: { id: true, status: true } } },
    });
    if (!profile) {
      throw new WorkforceError(
        "staff_not_found",
        404,
        "No workforce identity has that Staff ID.",
      );
    }
    if (profile.userId === input.actorUserId) {
      throw new WorkforceError(
        "cannot_terminate_self",
        409,
        "You cannot terminate your own workforce identity.",
      );
    }
    if (profile.employmentStatus === "TERMINATED") {
      return {
        alreadyTerminated: true,
        staffId: profile.staffId,
        revokedProductAccess: 0,
        revokedPlatformRoles: 0,
        revokedSessions: 0,
        revokedRefreshTokens: 0,
      };
    }

    const ownerGrant = await tx.platformRoleGrant.findFirst({
      where: { userId: profile.userId, role: "OWNER", revokedAt: null },
      select: { id: true },
    });
    if (ownerGrant) {
      const otherOwners = await tx.platformRoleGrant.count({
        where: {
          role: "OWNER",
          revokedAt: null,
          userId: { not: profile.userId },
          user: { status: "ACTIVE" },
        },
      });
      if (otherOwners === 0) {
        throw new WorkforceError(
          "cannot_terminate_last_owner",
          409,
          "This is the last active platform OWNER. Grant OWNER to another active staff identity first.",
        );
      }
    }

    const activeFrendeloSuperAdmin =
      await tx.workforceProductAccessGrant.findFirst({
        where: {
          workforceProfileId: profile.id,
          product: "FRENDELO",
          roleKey: "super_admin",
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { id: true },
      });
    if (activeFrendeloSuperAdmin) {
      const otherFrendeloSuperAdmins =
        await tx.workforceProductAccessGrant.count({
          where: {
            workforceProfileId: { not: profile.id },
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
      if (otherFrendeloSuperAdmins === 0) {
        throw new WorkforceError(
          "cannot_terminate_last_frendelo_super_admin",
          409,
          "Grant Frendelo Super Admin to another active workforce identity before terminating the final parent administrator.",
        );
      }
    }

    const provisioningSnapshots =
      await activeProvisionedProductSnapshots(tx, {
        workforceProfileId: profile.id,
        now,
      });

    const productAccess = await tx.workforceProductAccessGrant.updateMany({
      where: { workforceProfileId: profile.id, revokedAt: null },
      data: {
        revokedAt: now,
        revokedByUserId: input.actorUserId,
        provisioningState: "PENDING",
        revision: { increment: 1 },
      },
    });
    const platformRoles = await tx.platformRoleGrant.updateMany({
      where: { userId: profile.userId, revokedAt: null },
      data: { revokedAt: now, revokedByUserId: input.actorUserId },
    });
    const sessions = await tx.session.updateMany({
      where: { userId: profile.userId, revokedAt: null },
      data: { revokedAt: now },
    });
    const refreshTokens = await tx.oAuthRefreshToken.updateMany({
      where: { userId: profile.userId, revokedAt: null },
      data: { revokedAt: now },
    });

    await tx.user.update({
      where: { id: profile.userId },
      data: { status: "DISABLED", disabledAt: now },
    });
    const terminatedProfile = await tx.workforceProfile.update({
      where: { id: profile.id },
      data: {
        employmentStatus: "TERMINATED",
        endsAt: now,
        updatedByUserId: input.actorUserId,
        entitlementRevision: { increment: 1 },
      },
      select: { entitlementRevision: true },
    });
    const provisioningEventIds: string[] = [];
    for (const snapshot of provisioningSnapshots) {
      const event = await enqueueWorkforceProvisioningSnapshot(tx, {
        workforceProfileId: profile.id,
        staffId: input.staffId,
        product: snapshot.product,
        eventType: "terminate",
        entitlementRevision: terminatedProfile.entitlementRevision,
        productAccessActive: false,
        roleKeys: [],
        grantIds: [],
        relatedGrantIds: snapshot.grantIds,
      });
      if (event) provisioningEventIds.push(event.id);
    }

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        actorType: "ADMIN",
        targetUserId: profile.userId,
        eventType: "WORKFORCE_STAFF_TERMINATED",
        eventData: {
          staff_id: input.staffId,
          reason: input.reason,
          revoked_product_access: productAccess.count,
          revoked_platform_roles: platformRoles.count,
          revoked_sessions: sessions.count,
          revoked_refresh_tokens: refreshTokens.count,
          entitlement_revision: terminatedProfile.entitlementRevision,
          provisioning_event_ids: provisioningEventIds,
        },
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });

    return {
      alreadyTerminated: false,
      staffId: profile.staffId,
      revokedProductAccess: productAccess.count,
      revokedPlatformRoles: platformRoles.count,
      revokedSessions: sessions.count,
      revokedRefreshTokens: refreshTokens.count,
      entitlementRevision: terminatedProfile.entitlementRevision,
      provisioningEventIds,
    };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2034"
    ) {
      throw new WorkforceError(
        "workforce_change_conflict_retry",
        409,
        "Workforce authority changed concurrently. Refresh and retry.",
      );
    }
    throw error;
  }
}

export async function workforceProductContextByUserId(input: {
  userId: string;
  product: WorkforceProduct;
}) {
  const now = new Date();

  return db.$transaction(async (tx) => {
    const profile = await tx.workforceProfile.findUnique({
      where: { userId: input.userId },
      include: {
        user: { select: { email: true, displayName: true, status: true } },
        productAccess: {
          where: {
            product: input.product,
            revokedAt: null,
          },
          select: {
            id: true,
            roleKey: true,
            expiresAt: true,
            revision: true,
          },
        },
      },
    });

    if (
      !profile ||
      profile.employmentStatus !== "ACTIVE" ||
      profile.user.status !== "ACTIVE"
    ) {
      return null;
    }

    const expired = profile.productAccess.filter(
      (grant) => grant.expiresAt && grant.expiresAt <= now,
    );
    let entitlementRevision = profile.entitlementRevision;

    if (expired.length > 0) {
      const expiredIds = expired.map((grant) => grant.id);
      if (
        input.product === "FRENDELO" &&
        expired.some((grant) => grant.roleKey === "super_admin")
      ) {
        const otherSuperAdmins = await tx.workforceProductAccessGrant.count({
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
          throw new WorkforceError(
            "cannot_expire_last_frendelo_super_admin",
            409,
            "A legacy Frendelo Super Admin grant reached expiry while still the final parent administrator. Grant another active Super Admin before reconciliation.",
          );
        }
      }

      const revoked = await tx.workforceProductAccessGrant.updateMany({
        where: {
          id: { in: expiredIds },
          workforceProfileId: profile.id,
          product: input.product,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
          provisioningState: "PENDING",
          revision: { increment: 1 },
        },
      });
      if (revoked.count !== expired.length) {
        throw new WorkforceError(
          "product_access_change_conflict_retry",
          409,
          "Product access changed concurrently. Refresh and retry.",
        );
      }

      const revised = await tx.workforceProfile.update({
        where: { id: profile.id },
        data: { entitlementRevision: { increment: 1 } },
        select: { entitlementRevision: true },
      });
      entitlementRevision = revised.entitlementRevision;
      const provisioningSnapshot = await activeProductSnapshot(tx, {
        workforceProfileId: profile.id,
        product: input.product,
        now,
      });
      const provisioningEvent =
        await enqueueWorkforceProvisioningSnapshot(tx, {
          workforceProfileId: profile.id,
          staffId: profile.staffId,
          product: input.product,
          eventType: "expire",
          entitlementRevision,
          productAccessActive: provisioningSnapshot.roleKeys.length > 0,
          roleKeys: provisioningSnapshot.roleKeys,
          grantIds: provisioningSnapshot.grantIds,
          relatedGrantIds: expiredIds,
        });

      await tx.auditLog.create({
        data: {
          actorUserId: null,
          actorType: "SYSTEM",
          targetUserId: profile.userId,
          eventType: "WORKFORCE_PRODUCT_ACCESS_EXPIRED",
          eventData: {
            staff_id: profile.staffId,
            product: input.product.toLowerCase(),
            expired_grant_ids: expiredIds.sort(),
            expired_role_keys: Array.from(
              new Set(expired.map((grant) => grant.roleKey)),
            ).sort(),
            entitlement_revision: entitlementRevision,
            provisioning_event_id: provisioningEvent?.id ?? null,
          },
        },
      });
    }

    const active = profile.productAccess.filter(
      (grant) => !grant.expiresAt || grant.expiresAt > now,
    );
    if (active.length === 0) return null;

    return {
      staffId: profile.staffId,
      email: profile.user.email,
      name: profile.user.displayName,
      roleKeys: Array.from(
        new Set(active.map((grant) => grant.roleKey)),
      ).sort(),
      grantIds: active.map((grant) => grant.id).sort(),
      entitlementRevision,
    };
  });
}
