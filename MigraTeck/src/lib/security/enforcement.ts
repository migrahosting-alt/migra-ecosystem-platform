import { EntitlementStatus, OrgRole, Prisma, ProductKey } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { isInternalOrg } from "@/lib/security/internal-org";

export type EntitlementFeature = ProductKey | "DOWNLOADS" | "STORAGE" | "PODS" | "EMAIL" | "DOMAINS" | "PHONE_NUMBERS";

export type EntitlementErrorCode =
  | "UNSUPPORTED_FEATURE"
  | "ORG_NOT_FOUND"
  | "ENTITLEMENT_NOT_FOUND"
  | "ENTITLEMENT_STATUS_BLOCKED"
  | "ENTITLEMENT_WINDOW_NOT_STARTED"
  | "ENTITLEMENT_EXPIRED"
  | "TRIAL_EXPIRED"
  | "INTERNAL_ONLY_FORBIDDEN"
  | "INSUFFICIENT_STATUS";

export class EntitlementEnforcementError extends Error {
  code: EntitlementErrorCode;
  httpStatus: number;

  constructor(code: EntitlementErrorCode, message: string, httpStatus = 403) {
    super(message);
    this.name = "EntitlementEnforcementError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

interface AssertEntitlementInput {
  orgId: string;
  feature: EntitlementFeature;
  requiredStatus?: EntitlementStatus;
  allowInternal?: boolean;
  actorUserId?: string;
  actorRole?: OrgRole;
  ip?: string;
  userAgent?: string;
  route?: string;
  resourceId?: string;
  product?: ProductKey;
}

interface AssertEntitlementResult {
  orgId: string;
  feature: EntitlementFeature;
  product: ProductKey;
  entitlementStatus: EntitlementStatus;
  startsAt: Date | null;
  endsAt: Date | null;
}

const DEFAULT_FEATURE_PRODUCT_MAP: Record<Exclude<EntitlementFeature, ProductKey>, ProductKey> = {
  DOWNLOADS: ProductKey.MIGRAPANEL,
  STORAGE: ProductKey.MIGRAPANEL,
  PODS: ProductKey.MIGRAPANEL,
  EMAIL: ProductKey.MIGRAMAIL,
  DOMAINS: ProductKey.MIGRAPANEL,
  PHONE_NUMBERS: ProductKey.MIGRAVOICE,
};

const PRODUCT_KEYS = new Set(Object.values(ProductKey));

function resolveProduct(feature: EntitlementFeature, product?: ProductKey): ProductKey {
  if (PRODUCT_KEYS.has(feature as ProductKey)) {
    return feature as ProductKey;
  }

  const mapped = DEFAULT_FEATURE_PRODUCT_MAP[feature as keyof typeof DEFAULT_FEATURE_PRODUCT_MAP];
  if (mapped) {
    return product || mapped;
  }

  if (product) {
    return product;
  }

  throw new EntitlementEnforcementError("UNSUPPORTED_FEATURE", "Unsupported entitlement feature.", 400);
}

function isStatusAllowed(actual: EntitlementStatus, required: EntitlementStatus): boolean {
  if (required === EntitlementStatus.ACTIVE) {
    return actual === EntitlementStatus.ACTIVE || actual === EntitlementStatus.TRIAL;
  }

  if (required === EntitlementStatus.TRIAL) {
    return actual === EntitlementStatus.TRIAL;
  }

  if (required === EntitlementStatus.INTERNAL_ONLY) {
    return actual === EntitlementStatus.INTERNAL_ONLY;
  }

  return actual !== EntitlementStatus.INTERNAL_ONLY;
}

async function auditOutcome(
  action: "ENTITLEMENT_ENFORCED" | "ENTITLEMENT_ENFORCEMENT_DENIED",
  input: AssertEntitlementInput,
  metadata: Record<string, unknown>,
) {
  await writeAuditLog({
    actorId: input.actorUserId || null,
    actorRole: input.actorRole || null,
    orgId: input.orgId,
    action,
    resourceType: "entitlement",
    resourceId: input.resourceId || (typeof input.feature === "string" ? input.feature : undefined),
    ip: input.ip,
    userAgent: input.userAgent,
    riskTier: action === "ENTITLEMENT_ENFORCED" ? 0 : 1,
    metadata: JSON.parse(JSON.stringify(metadata)) as Prisma.InputJsonValue,
  });
}

export async function assertEntitlement(input: AssertEntitlementInput): Promise<AssertEntitlementResult> {
  const now = new Date();
  const requiredStatus = input.requiredStatus || EntitlementStatus.ACTIVE;
  const resolvedProduct = resolveProduct(input.feature, input.product);

  const org = await prisma.organization.findUnique({
    where: { id: input.orgId },
    select: {
      id: true,
      slug: true,
    },
  });

  if (!org) {
    throw new EntitlementEnforcementError("ORG_NOT_FOUND", "Organization not found.", 404);
  }

  const entitlement = await prisma.orgEntitlement.findUnique({
    where: {
      orgId_product: {
        orgId: input.orgId,
        product: resolvedProduct,
      },
    },
    select: {
      status: true,
      startsAt: true,
      endsAt: true,
    },
  });

  if (!entitlement) {
    await auditOutcome("ENTITLEMENT_ENFORCEMENT_DENIED", input, {
      code: "ENTITLEMENT_NOT_FOUND",
      feature: input.feature,
      product: resolvedProduct,
      requiredStatus,
      route: input.route || null,
    });
    throw new EntitlementEnforcementError("ENTITLEMENT_NOT_FOUND", "Feature entitlement is not active.");
  }

  const internalOrg = isInternalOrg(org);

  if (entitlement.status === EntitlementStatus.INTERNAL_ONLY && (!input.allowInternal || !internalOrg)) {
    await auditOutcome("ENTITLEMENT_ENFORCEMENT_DENIED", input, {
      code: "INTERNAL_ONLY_FORBIDDEN",
      feature: input.feature,
      product: resolvedProduct,
      requiredStatus,
      actualStatus: entitlement.status,
      internalOrg,
      route: input.route || null,
    });

    throw new EntitlementEnforcementError("INTERNAL_ONLY_FORBIDDEN", "Feature entitlement is not active.");
  }

  if (entitlement.status === EntitlementStatus.RESTRICTED) {
    await auditOutcome("ENTITLEMENT_ENFORCEMENT_DENIED", input, {
      code: "ENTITLEMENT_STATUS_BLOCKED",
      feature: input.feature,
      product: resolvedProduct,
      requiredStatus,
      actualStatus: entitlement.status,
      route: input.route || null,
    });

    throw new EntitlementEnforcementError("ENTITLEMENT_STATUS_BLOCKED", "Feature entitlement is not active.");
  }

  if (entitlement.startsAt && entitlement.startsAt > now) {
    await auditOutcome("ENTITLEMENT_ENFORCEMENT_DENIED", input, {
      code: "ENTITLEMENT_WINDOW_NOT_STARTED",
      feature: input.feature,
      product: resolvedProduct,
      requiredStatus,
      startsAt: entitlement.startsAt,
      route: input.route || null,
    });

    throw new EntitlementEnforcementError("ENTITLEMENT_WINDOW_NOT_STARTED", "Feature entitlement is not active.");
  }

  if (entitlement.endsAt && entitlement.endsAt <= now) {
    const code = entitlement.status === EntitlementStatus.TRIAL ? "TRIAL_EXPIRED" : "ENTITLEMENT_EXPIRED";

    await auditOutcome("ENTITLEMENT_ENFORCEMENT_DENIED", input, {
      code,
      feature: input.feature,
      product: resolvedProduct,
      requiredStatus,
      actualStatus: entitlement.status,
      endsAt: entitlement.endsAt,
      route: input.route || null,
    });

    throw new EntitlementEnforcementError(code, "Feature entitlement is not active.");
  }

  if (!isStatusAllowed(entitlement.status, requiredStatus)) {
    await auditOutcome("ENTITLEMENT_ENFORCEMENT_DENIED", input, {
      code: "INSUFFICIENT_STATUS",
      feature: input.feature,
      product: resolvedProduct,
      requiredStatus,
      actualStatus: entitlement.status,
      route: input.route || null,
    });

    throw new EntitlementEnforcementError("INSUFFICIENT_STATUS", "Feature entitlement is not active.");
  }

  await auditOutcome("ENTITLEMENT_ENFORCED", input, {
    feature: input.feature,
    product: resolvedProduct,
    requiredStatus,
    actualStatus: entitlement.status,
    startsAt: entitlement.startsAt,
    endsAt: entitlement.endsAt,
    route: input.route || null,
  });

  return {
    orgId: input.orgId,
    feature: input.feature,
    product: resolvedProduct,
    entitlementStatus: entitlement.status,
    startsAt: entitlement.startsAt,
    endsAt: entitlement.endsAt,
  };
}
