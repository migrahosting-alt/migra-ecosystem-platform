import { DriveTenantActorType, DriveTenantStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { appendTenantEvent } from "./drive-tenant-events";
import {
  recordDriveDisable,
  recordDrivePlanChange,
  recordDriveReactivation,
  recordDriveRestrict,
} from "./drive-tenant-metrics";
import type { TenantActionContext } from "./drive-tenant-types";

// ── Transition validation ───────────────────────────────────

const VALID_TRANSITIONS: Record<DriveTenantStatus, DriveTenantStatus[]> = {
  PENDING: [DriveTenantStatus.ACTIVE],
  ACTIVE: [DriveTenantStatus.RESTRICTED, DriveTenantStatus.DISABLED],
  RESTRICTED: [DriveTenantStatus.ACTIVE, DriveTenantStatus.DISABLED],
  DISABLED: [DriveTenantStatus.ACTIVE],
};

function isValidTransition(from: DriveTenantStatus, to: DriveTenantStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Input types ─────────────────────────────────────────────

interface ActivateTenantInput extends TenantActionContext {
  tenantId: string;
  reason?: string | undefined;
}

interface RestrictTenantInput extends TenantActionContext {
  tenantId: string;
  reason: string;
}

interface DisableTenantInput extends TenantActionContext {
  tenantId: string;
  reason?: string | undefined;
}

interface UpdateTenantPlanInput extends TenantActionContext {
  tenantId: string;
  planCode: string;
  storageQuotaGb: number;
  subscriptionId?: string | null | undefined;
  entitlementId?: string | null | undefined;
}

// ── Lifecycle operations ────────────────────────────────────

export async function activateTenant(input: ActivateTenantInput) {
  const tenant = await prisma.driveTenant.findUniqueOrThrow({ where: { id: input.tenantId } });

  if (tenant.status === DriveTenantStatus.ACTIVE) {
    return { tenant, changed: false };
  }

  if (!isValidTransition(tenant.status, DriveTenantStatus.ACTIVE)) {
    throw new Error(`Invalid transition: ${tenant.status} → ACTIVE`);
  }

  const updated = await prisma.driveTenant.update({
    where: { id: tenant.id },
    data: {
      status: DriveTenantStatus.ACTIVE,
      activatedAt: new Date(),
      disabledAt: null,
      disableReason: null,
      restrictedAt: null,
      restrictionReason: null,
    },
  });

  await appendTenantEvent({
    tenantId: tenant.id,
    orgId: tenant.orgId,
    action: "TENANT_ACTIVATED",
    previousStatus: tenant.status,
    newStatus: DriveTenantStatus.ACTIVE,
    actorType: input.actorType,
    actorId: input.actorId,
    traceId: input.traceId,
    idempotencyKey: input.idempotencyKey,
    metadata: {
      reason: input.reason ?? null,
      ...(input.metadata ?? {}),
    },
  });

  recordDriveReactivation({ orgId: tenant.orgId, tenantId: tenant.id, source: input.actorType });

  return { tenant: updated, changed: true };
}

export async function restrictTenant(input: RestrictTenantInput) {
  const tenant = await prisma.driveTenant.findUniqueOrThrow({ where: { id: input.tenantId } });

  if (tenant.status === DriveTenantStatus.RESTRICTED) {
    return { tenant, changed: false };
  }

  if (!isValidTransition(tenant.status, DriveTenantStatus.RESTRICTED)) {
    throw new Error(`Invalid transition: ${tenant.status} → RESTRICTED`);
  }

  const updated = await prisma.driveTenant.update({
    where: { id: tenant.id },
    data: {
      status: DriveTenantStatus.RESTRICTED,
      restrictedAt: new Date(),
      restrictionReason: input.reason,
    },
  });

  await appendTenantEvent({
    tenantId: tenant.id,
    orgId: tenant.orgId,
    action: "TENANT_RESTRICTED",
    previousStatus: tenant.status,
    newStatus: DriveTenantStatus.RESTRICTED,
    actorType: input.actorType,
    actorId: input.actorId,
    traceId: input.traceId,
    idempotencyKey: input.idempotencyKey,
    metadata: {
      reason: input.reason,
      ...(input.metadata ?? {}),
    },
  });

  recordDriveRestrict({ orgId: tenant.orgId, tenantId: tenant.id, source: input.actorType });

  return { tenant: updated, changed: true };
}

export async function disableTenant(input: DisableTenantInput) {
  const tenant = await prisma.driveTenant.findUniqueOrThrow({ where: { id: input.tenantId } });

  if (tenant.status === DriveTenantStatus.DISABLED) {
    return { tenant, changed: false };
  }

  if (!isValidTransition(tenant.status, DriveTenantStatus.DISABLED)) {
    throw new Error(`Invalid transition: ${tenant.status} → DISABLED`);
  }

  const updated = await prisma.driveTenant.update({
    where: { id: tenant.id },
    data: {
      status: DriveTenantStatus.DISABLED,
      disabledAt: new Date(),
      disableReason: input.reason || null,
    },
  });

  await appendTenantEvent({
    tenantId: tenant.id,
    orgId: tenant.orgId,
    action: "TENANT_DISABLED",
    previousStatus: tenant.status,
    newStatus: DriveTenantStatus.DISABLED,
    actorType: input.actorType,
    actorId: input.actorId,
    traceId: input.traceId,
    idempotencyKey: input.idempotencyKey,
    metadata: {
      reason: input.reason || null,
      ...(input.metadata ?? {}),
    },
  });

  recordDriveDisable({ orgId: tenant.orgId, tenantId: tenant.id, source: input.actorType });

  return { tenant: updated, changed: true };
}

export async function updateTenantPlan(input: UpdateTenantPlanInput) {
  const tenant = await prisma.driveTenant.findUniqueOrThrow({ where: { id: input.tenantId } });

  const previousPlanCode = tenant.planCode;
  const previousQuotaGb = tenant.storageQuotaGb;

  const updated = await prisma.driveTenant.update({
    where: { id: tenant.id },
    data: {
      planCode: input.planCode,
      storageQuotaGb: input.storageQuotaGb,
      subscriptionId: input.subscriptionId ?? tenant.subscriptionId,
      entitlementId: input.entitlementId ?? tenant.entitlementId,
    },
  });

  await appendTenantEvent({
    tenantId: tenant.id,
    orgId: tenant.orgId,
    action: "TENANT_PLAN_UPDATED",
    previousStatus: tenant.status,
    newStatus: tenant.status,
    previousPlanCode,
    newPlanCode: input.planCode,
    previousQuotaGb,
    newQuotaGb: input.storageQuotaGb,
    subscriptionId: input.subscriptionId,
    entitlementId: input.entitlementId,
    actorType: input.actorType,
    actorId: input.actorId,
    traceId: input.traceId,
    idempotencyKey: input.idempotencyKey,
    metadata: input.metadata,
  });

  // ── Auto-restrict if storage exceeds new quota ──────────
  let finalTenant = updated;
  const isOverQuota =
    Number(tenant.storageUsedBytes) > input.storageQuotaGb * 1024 * 1024 * 1024;

  if (tenant.status !== DriveTenantStatus.DISABLED && isOverQuota) {
    if (tenant.status === DriveTenantStatus.RESTRICTED) {
      finalTenant = await prisma.driveTenant.update({
        where: { id: tenant.id },
        data: {
          restrictedAt: tenant.restrictedAt ?? new Date(),
          restrictionReason: "quota_exceeded_after_downgrade",
        },
      });
    } else {
    const restriction = await restrictTenant({
      tenantId: tenant.id,
      reason: "quota_exceeded_after_downgrade",
      actorType: DriveTenantActorType.SYSTEM,
      traceId: input.traceId,
      idempotencyKey: input.idempotencyKey
        ? `${input.idempotencyKey}:auto_restrict`
        : null,
    });

    finalTenant = restriction.tenant;
    }
  }

  recordDrivePlanChange({
    orgId: tenant.orgId,
    tenantId: tenant.id,
    previousPlanCode,
    newPlanCode: finalTenant.planCode,
  });

  return { tenant: finalTenant, previousPlanCode, previousQuotaGb };
}
