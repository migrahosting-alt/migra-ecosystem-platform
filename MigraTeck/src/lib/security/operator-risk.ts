import { OrgRole } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { roleAtLeast } from "@/lib/rbac";

export type MutationRiskTier = 0 | 1 | 2;

export class OperatorRiskError extends Error {
  httpStatus: number;

  constructor(message: string, httpStatus = 403) {
    super(message);
    this.name = "OperatorRiskError";
    this.httpStatus = httpStatus;
  }
}

interface AssertOperatorRiskAllowedInput {
  actorUserId: string;
  actorRole?: OrgRole | null;
  orgId?: string | null;
  action: string;
  riskTier: MutationRiskTier;
  ip?: string;
  userAgent?: string;
  route?: string;
}

function roleSatisfiesTier(role: OrgRole | null | undefined, tier: MutationRiskTier): boolean {
  if (tier === 0) {
    return true;
  }

  if (tier === 1) {
    if (!role) {
      return true;
    }

    return roleAtLeast(role, OrgRole.MEMBER);
  }

  if (!role) {
    return false;
  }

  return roleAtLeast(role, OrgRole.ADMIN);
}

export async function assertOperatorRiskAllowed(input: AssertOperatorRiskAllowedInput): Promise<void> {
  if (roleSatisfiesTier(input.actorRole, input.riskTier)) {
    return;
  }

  await writeAuditLog({
    actorId: input.actorUserId,
    actorRole: input.actorRole || null,
    orgId: input.orgId || null,
    action: "AUTHZ_RISK_TIER_DENIED",
    resourceType: "mutation",
    resourceId: input.action,
    ip: input.ip,
    userAgent: input.userAgent,
    riskTier: 2,
    metadata: {
      route: input.route || null,
      requiredRiskTier: input.riskTier,
      actorRole: input.actorRole || null,
    },
  });

  throw new OperatorRiskError("Risk-tier authorization failed.", 403);
}
