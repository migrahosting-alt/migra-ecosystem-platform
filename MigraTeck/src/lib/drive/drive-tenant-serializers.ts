import type { DriveTenant, DriveTenantEvent, DriveTenantOperation } from "@prisma/client";

export function serializeDriveTenant(tenant: DriveTenant) {
  return {
    id: tenant.id,
    orgId: tenant.orgId,
    orgSlug: tenant.orgSlug,
    status: tenant.status,
    planCode: tenant.planCode,
    storageQuotaGb: tenant.storageQuotaGb,
    storageUsedBytes: tenant.storageUsedBytes.toString(),
    subscriptionId: tenant.subscriptionId,
    entitlementId: tenant.entitlementId,
    externalRef: tenant.externalRef,
    createdAt: tenant.createdAt.toISOString(),
    updatedAt: tenant.updatedAt.toISOString(),
    activatedAt: tenant.activatedAt?.toISOString() ?? null,
    restrictedAt: tenant.restrictedAt?.toISOString() ?? null,
    disabledAt: tenant.disabledAt?.toISOString() ?? null,
    disableReason: tenant.disableReason,
    restrictionReason: tenant.restrictionReason,
  };
}

export function serializeDriveTenantEvent(event: DriveTenantEvent) {
  return {
    id: event.id,
    tenantId: event.tenantId,
    orgId: event.orgId,
    action: event.action,
    previousStatus: event.previousStatus,
    newStatus: event.newStatus,
    previousPlanCode: event.previousPlanCode,
    newPlanCode: event.newPlanCode,
    previousQuotaGb: event.previousQuotaGb,
    newQuotaGb: event.newQuotaGb,
    subscriptionId: event.subscriptionId,
    entitlementId: event.entitlementId,
    idempotencyKey: event.idempotencyKey,
    traceId: event.traceId,
    actorType: event.actorType,
    actorId: event.actorId,
    metadata: event.metadataJson ? JSON.parse(event.metadataJson) : null,
    createdAt: event.createdAt.toISOString(),
  };
}

export function serializeDriveTenantOperation(operation: DriveTenantOperation) {
  return {
    id: operation.id,
    tenantId: operation.tenantId,
    orgId: operation.orgId,
    operationType: operation.operationType,
    status: operation.status,
    request: operation.requestJson ? JSON.parse(operation.requestJson) : null,
    response: operation.responseJson ? JSON.parse(operation.responseJson) : null,
    errorCode: operation.errorCode,
    errorMessage: operation.errorMessage,
    idempotencyKey: operation.idempotencyKey,
    traceId: operation.traceId,
    startedAt: operation.startedAt.toISOString(),
    completedAt: operation.completedAt?.toISOString() ?? null,
  };
}
