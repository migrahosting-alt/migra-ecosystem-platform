import { OrgRole } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { can, type PermissionAction } from "@/lib/rbac";

interface PermissionCheckInput {
  actorUserId: string;
  orgId: string;
  role: OrgRole;
  action: PermissionAction;
  route: string;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export async function assertPermission(input: PermissionCheckInput): Promise<boolean> {
  const allowed = can(input.role, input.action);

  if (allowed) {
    return true;
  }

  await writeAuditLog({
    actorId: input.actorUserId,
    actorRole: input.role,
    orgId: input.orgId,
    action: "AUTHZ_PERMISSION_DENIED",
    resourceType: "permission",
    resourceId: input.action,
    ip: input.ip,
    userAgent: input.userAgent,
    riskTier: 1,
    metadata: {
      route: input.route,
      role: input.role,
      requiredAction: input.action,
    },
  });

  return false;
}
