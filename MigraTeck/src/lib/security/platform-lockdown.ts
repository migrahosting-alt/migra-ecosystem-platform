import { OrgRole } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { getPlatformConfig, isPlatformOwner } from "@/lib/platform-config";

const FREEZE_BLOCKED_ACTIONS = new Set([
  "org:create",
  "org:invite:create",
  "org:invite:revoke",
  "org:invite:resend",
  "pod:create",
]);

export class PlatformLockdownError extends Error {
  httpStatus: number;

  constructor(message: string, httpStatus = 503) {
    super(message);
    this.name = "PlatformLockdownError";
    this.httpStatus = httpStatus;
  }
}

interface AssertPlatformMutationAllowedInput {
  action: string;
  actorUserId: string;
  actorRole?: OrgRole | null;
  orgId?: string | null;
  ip?: string;
  userAgent?: string;
  route?: string;
}

export async function assertPlatformMutationAllowed(input: AssertPlatformMutationAllowedInput): Promise<void> {
  const config = await getPlatformConfig();

  if (!config.maintenanceMode && !config.freezeProvisioning) {
    return;
  }

  const ownerOverride = input.actorRole === OrgRole.OWNER || (await isPlatformOwner(input.actorUserId));

  if (ownerOverride) {
    return;
  }

  if (config.maintenanceMode) {
    await writeAuditLog({
      actorId: input.actorUserId,
      actorRole: input.actorRole || null,
      orgId: input.orgId || null,
      action: "PLATFORM_LOCKDOWN_BLOCKED",
      resourceType: "mutation",
      resourceId: input.action,
      ip: input.ip,
      userAgent: input.userAgent,
      riskTier: 2,
      metadata: {
        mode: "maintenanceMode",
        route: input.route || null,
      },
    });

    throw new PlatformLockdownError("Platform is in maintenance mode.", 503);
  }

  if (config.freezeProvisioning && FREEZE_BLOCKED_ACTIONS.has(input.action)) {
    await writeAuditLog({
      actorId: input.actorUserId,
      actorRole: input.actorRole || null,
      orgId: input.orgId || null,
      action: "PLATFORM_LOCKDOWN_BLOCKED",
      resourceType: "mutation",
      resourceId: input.action,
      ip: input.ip,
      userAgent: input.userAgent,
      riskTier: 2,
      metadata: {
        mode: "freezeProvisioning",
        route: input.route || null,
      },
    });

    throw new PlatformLockdownError("Provisioning is temporarily frozen.", 423);
  }
}
