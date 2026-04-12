import { MembershipStatus, OrgRole, type PlatformConfig } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export const PLATFORM_CONFIG_SINGLETON_ID = "default";

export type PlatformConfigPatch = Partial<
  Pick<
    PlatformConfig,
    | "allowPublicSignup"
    | "allowOrgCreate"
    | "waitlistMode"
    | "maintenanceMode"
    | "freezeProvisioning"
    | "pauseProvisioningWorker"
    | "pauseEntitlementExpiryWorker"
  >
>;

export class PlatformConfigPermissionError extends Error {
  constructor() {
    super("Owner role required");
    this.name = "PlatformConfigPermissionError";
  }
}

export async function getPlatformConfig(): Promise<PlatformConfig> {
  return prisma.platformConfig.upsert({
    where: { id: PLATFORM_CONFIG_SINGLETON_ID },
    update: {},
    create: {
      id: PLATFORM_CONFIG_SINGLETON_ID,
    },
  });
}

export async function isPlatformOwner(userId: string): Promise<boolean> {
  const ownerMembership = await prisma.membership.findFirst({
    where: {
      userId,
      status: MembershipStatus.ACTIVE,
      role: OrgRole.OWNER,
    },
    select: { id: true },
  });

  return Boolean(ownerMembership);
}

interface UpdatePlatformConfigInput {
  actorUserId: string;
  patch: PlatformConfigPatch;
  ip?: string;
  userAgent?: string;
}

export async function updatePlatformConfig(input: UpdatePlatformConfigInput): Promise<PlatformConfig> {
  const ownerMembership = await prisma.membership.findFirst({
    where: {
      userId: input.actorUserId,
      status: MembershipStatus.ACTIVE,
      role: OrgRole.OWNER,
    },
    select: {
      orgId: true,
    },
  });

  if (!ownerMembership) {
    await writeAuditLog({
      userId: input.actorUserId,
      action: "AUTHZ_PERMISSION_DENIED",
      entityType: "permission",
      entityId: "platform:config:manage",
      orgId: null,
      ip: input.ip,
      userAgent: input.userAgent,
      metadata: {
        route: "/api/platform/config",
        reason: "owner_required",
      },
    });

    throw new PlatformConfigPermissionError();
  }

  const current = await getPlatformConfig();

  const updated = await prisma.platformConfig.update({
    where: { id: PLATFORM_CONFIG_SINGLETON_ID },
    data: {
      ...(input.patch.allowPublicSignup !== undefined ? { allowPublicSignup: input.patch.allowPublicSignup } : {}),
      ...(input.patch.allowOrgCreate !== undefined ? { allowOrgCreate: input.patch.allowOrgCreate } : {}),
      ...(input.patch.waitlistMode !== undefined ? { waitlistMode: input.patch.waitlistMode } : {}),
      ...(input.patch.maintenanceMode !== undefined ? { maintenanceMode: input.patch.maintenanceMode } : {}),
      ...(input.patch.freezeProvisioning !== undefined ? { freezeProvisioning: input.patch.freezeProvisioning } : {}),
      ...(input.patch.pauseProvisioningWorker !== undefined ? { pauseProvisioningWorker: input.patch.pauseProvisioningWorker } : {}),
      ...(input.patch.pauseEntitlementExpiryWorker !== undefined
        ? { pauseEntitlementExpiryWorker: input.patch.pauseEntitlementExpiryWorker }
        : {}),
    },
  });

  const changedFields = [
    "allowPublicSignup",
    "allowOrgCreate",
    "waitlistMode",
    "maintenanceMode",
    "freezeProvisioning",
    "pauseProvisioningWorker",
    "pauseEntitlementExpiryWorker",
  ].filter((field) => {
    const key = field as keyof PlatformConfigPatch;
    return input.patch[key] !== undefined && current[key] !== updated[key];
  });

  await writeAuditLog({
    userId: input.actorUserId,
    orgId: ownerMembership.orgId,
    action: "PLATFORM_CONFIG_UPDATED",
    entityType: "platform_config",
    entityId: PLATFORM_CONFIG_SINGLETON_ID,
    ip: input.ip,
    userAgent: input.userAgent,
    metadata: {
      changedFields,
      old: {
        allowPublicSignup: current.allowPublicSignup,
        allowOrgCreate: current.allowOrgCreate,
        waitlistMode: current.waitlistMode,
        maintenanceMode: current.maintenanceMode,
        freezeProvisioning: current.freezeProvisioning,
        pauseProvisioningWorker: current.pauseProvisioningWorker,
        pauseEntitlementExpiryWorker: current.pauseEntitlementExpiryWorker,
      },
      new: {
        allowPublicSignup: updated.allowPublicSignup,
        allowOrgCreate: updated.allowOrgCreate,
        waitlistMode: updated.waitlistMode,
        maintenanceMode: updated.maintenanceMode,
        freezeProvisioning: updated.freezeProvisioning,
        pauseProvisioningWorker: updated.pauseProvisioningWorker,
        pauseEntitlementExpiryWorker: updated.pauseEntitlementExpiryWorker,
      },
    },
  });

  return updated;
}
