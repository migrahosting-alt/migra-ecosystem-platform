import { EntitlementStatus, Prisma, ProductKey, ProvisioningAction, ProvisioningJobSource } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { hashCanonicalPayload } from "@/lib/security/canonical";
import { isInternalOrg } from "@/lib/security/internal-org";
import { mapProvisioningActionToJobType, queueProvisioningJob } from "@/lib/provisioning/jobs";

interface QueueProvisioningTaskInput {
  orgId: string;
  product?: ProductKey | undefined;
  action: ProvisioningAction;
  payload?: Record<string, unknown> | undefined;
  createdByUserId?: string | undefined;
  actorRole?: string | null | undefined;
  source?: ProvisioningJobSource | undefined;
  idempotencyKey?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

interface EntitlementTransitionInput {
  orgId: string;
  orgSlug: string;
  product: ProductKey;
  previousStatus: EntitlementStatus | null;
  newStatus: EntitlementStatus;
  createdByUserId?: string | undefined;
  actorRole?: string | null | undefined;
  source?: ProvisioningJobSource | undefined;
  transitionId?: string | undefined;
  payload?: Record<string, unknown> | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

const ACTIVE_LIKE = new Set<EntitlementStatus>([
  EntitlementStatus.ACTIVE,
  EntitlementStatus.TRIAL,
  EntitlementStatus.INTERNAL_ONLY,
]);

function buildProvisionActionsForProduct(product: ProductKey, internal: boolean): ProvisioningAction[] {
  switch (product) {
    case ProductKey.MIGRATECK:
      return [ProvisioningAction.ACCESS_GRANT];
    case ProductKey.MIGRAHOSTING:
      return [
        ...(internal ? [] : [ProvisioningAction.POD_CREATE]),
        ProvisioningAction.DNS_PROVISION,
      ];
    case ProductKey.MIGRAPANEL:
      return [
        ...(internal ? [] : [ProvisioningAction.POD_CREATE]),
        ProvisioningAction.DNS_PROVISION,
        ProvisioningAction.STORAGE_PROVISION,
      ];
    case ProductKey.MIGRAVOICE:
      return [ProvisioningAction.VOICE_PROVISION];
    case ProductKey.MIGRAMAIL:
      return [ProvisioningAction.MAIL_PROVISION];
    case ProductKey.MIGRAINTAKE:
      return [ProvisioningAction.INTAKE_PROVISION];
    case ProductKey.MIGRAMARKET:
      return [ProvisioningAction.MARKET_PROVISION];
    case ProductKey.MIGRAPILOT:
      return [ProvisioningAction.PILOT_PROVISION];
    case ProductKey.MIGRADRIVE:
      return [ProvisioningAction.DRIVE_PROVISION];
    default:
      return [];
  }
}

function buildRestrictionActionsForProduct(product: ProductKey, internal: boolean): ProvisioningAction[] {
  switch (product) {
    case ProductKey.MIGRATECK:
      return [ProvisioningAction.ACCESS_RESTRICT];
    case ProductKey.MIGRAHOSTING:
    case ProductKey.MIGRAPANEL:
      return [
        ...(internal ? [] : [ProvisioningAction.POD_SCALE_DOWN]),
        ProvisioningAction.STORAGE_READ_ONLY,
      ];
    case ProductKey.MIGRAVOICE:
      return [ProvisioningAction.VOICE_DISABLE];
    case ProductKey.MIGRAMAIL:
      return [ProvisioningAction.MAIL_DISABLE];
    case ProductKey.MIGRAINTAKE:
    case ProductKey.MIGRAMARKET:
    case ProductKey.MIGRAPILOT:
      return [ProvisioningAction.ACCESS_RESTRICT];
    case ProductKey.MIGRADRIVE:
      return [ProvisioningAction.DRIVE_DISABLE];
    default:
      return [];
  }
}

function buildActionsForTransition(input: EntitlementTransitionInput): ProvisioningAction[] {
  const wasAllowed = input.previousStatus ? ACTIVE_LIKE.has(input.previousStatus) : false;
  const nowAllowed = ACTIVE_LIKE.has(input.newStatus);
  const internal = isInternalOrg({ slug: input.orgSlug });

  if (!wasAllowed && nowAllowed) {
    return buildProvisionActionsForProduct(input.product, internal);
  }

  if (wasAllowed && input.newStatus === EntitlementStatus.RESTRICTED) {
    return buildRestrictionActionsForProduct(input.product, internal);
  }

  return [];
}

export async function queueProvisioningTask(input: QueueProvisioningTaskInput): Promise<void> {
  const normalizedPayload = input.payload
    ? (JSON.parse(JSON.stringify(input.payload)) as Prisma.InputJsonValue)
    : Prisma.JsonNull;

  const task = await prisma.provisioningTask.create({
    data: {
      orgId: input.orgId,
      action: input.action,
      product: input.product || null,
      payload: normalizedPayload,
      createdByUserId: input.createdByUserId || null,
    },
  });

  await writeAuditLog({
    actorId: input.createdByUserId || null,
    actorRole: input.actorRole || null,
    orgId: input.orgId,
    action: "PROVISIONING_TASK_QUEUED",
    resourceType: "provisioning_task",
    resourceId: task.id,
    ip: input.ip,
    userAgent: input.userAgent,
    riskTier: 1,
    metadata: {
      action: input.action,
      product: input.product || null,
      payload: input.payload ? (JSON.parse(JSON.stringify(input.payload)) as Prisma.InputJsonValue) : null,
    },
  });

  const idempotencyKey =
    input.idempotencyKey ||
    `legacy:${input.orgId}:${input.product || "none"}:${input.action}:${hashCanonicalPayload(input.payload || null)}`;

  await queueProvisioningJob({
    orgId: input.orgId,
    createdByActorId: input.createdByUserId || null,
    source: input.source || (input.createdByUserId ? ProvisioningJobSource.MANUAL : ProvisioningJobSource.SYSTEM),
    type: mapProvisioningActionToJobType(input.action),
    payload: {
      action: input.action,
      product: input.product || null,
      ...(input.payload || {}),
    },
    idempotencyKey,
    ...(input.ip !== undefined ? { ip: input.ip } : {}),
    ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
  });
}

export async function queueProvisioningForEntitlementTransition(input: EntitlementTransitionInput): Promise<void> {
  const actions = buildActionsForTransition(input);
  const transitionId = input.transitionId || randomUUID();

  for (const action of actions) {
    await queueProvisioningTask({
      orgId: input.orgId,
      product: input.product,
      action,
      payload: {
        ...(input.payload || {}),
        productLane: input.product,
        previousStatus: input.previousStatus,
        newStatus: input.newStatus,
        transitionId,
      },
      source: input.source || ProvisioningJobSource.SYSTEM,
      idempotencyKey: `entitlement:${transitionId}:${input.orgId}:${input.product}:${action}`,
      createdByUserId: input.createdByUserId,
      actorRole: input.actorRole || null,
      ip: input.ip,
      userAgent: input.userAgent,
    });
  }
}
