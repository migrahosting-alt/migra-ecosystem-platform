import { BillingSubscriptionStatus, DriveTenantActorType, ProductKey } from "@prisma/client";
import { resolveMigraDrivePlanConfigByPriceId } from "./drive-plan-config";
import { getDriveTenantByOrgId } from "./drive-tenant-lookup";
import {
  activateTenant,
  disableTenant,
  restrictTenant,
  updateTenantPlan,
} from "./drive-tenant-lifecycle";

export type DriveBillingState = "GOOD_STANDING" | "PAST_DUE" | "CANCELED";

export function mapSubscriptionStatusToDriveBillingState(
  status: BillingSubscriptionStatus,
): DriveBillingState {
  switch (status) {
    case BillingSubscriptionStatus.ACTIVE:
    case BillingSubscriptionStatus.TRIALING:
      return "GOOD_STANDING";
    case BillingSubscriptionStatus.CANCELED:
      return "CANCELED";
    case BillingSubscriptionStatus.PAST_DUE:
    case BillingSubscriptionStatus.UNPAID:
    case BillingSubscriptionStatus.PAUSED:
    case BillingSubscriptionStatus.INCOMPLETE:
    case BillingSubscriptionStatus.INCOMPLETE_EXPIRED:
    default:
      return "PAST_DUE";
  }
}

export function resolveDrivePlanFromPriceIds(
  priceIds: string[],
): { planCode: string; storageQuotaGb: number } | null {
  for (const priceId of priceIds) {
    const plan = resolveMigraDrivePlanConfigByPriceId(priceId);
    if (!plan) {
      continue;
    }

    return { planCode: plan.planCode, storageQuotaGb: plan.storageQuotaGb };
  }

  return null;
}

interface ApplyDriveBillingStateInput {
  orgId: string;
  billingState: DriveBillingState;
  planCode?: string | undefined;
  storageQuotaGb?: number | undefined;
  subscriptionId?: string | null | undefined;
  entitlementId?: string | null | undefined;
  traceId?: string | null | undefined;
  idempotencyKey?: string | null | undefined;
}

export async function applyDriveBillingState(input: ApplyDriveBillingStateInput) {
  const tenant = await getDriveTenantByOrgId(input.orgId);
  if (!tenant) {
    return { ok: false as const, error: "tenant_not_found" };
  }

  let currentTenant = tenant;

  if (input.planCode && input.storageQuotaGb) {
    const planResult = await updateTenantPlan({
      tenantId: tenant.id,
      planCode: input.planCode,
      storageQuotaGb: input.storageQuotaGb,
      subscriptionId: input.subscriptionId,
      entitlementId: input.entitlementId,
      actorType: DriveTenantActorType.SYSTEM,
      actorId: "billing-enforcer",
      traceId: input.traceId,
      idempotencyKey: input.idempotencyKey,
      metadata: {
        billingState: input.billingState,
      },
    });

    currentTenant = planResult.tenant;
  }

  if (input.billingState === "GOOD_STANDING") {
    if (currentTenant.restrictionReason === "quota_exceeded_after_downgrade") {
      return { ok: true as const, tenant: currentTenant, action: "plan_updated" as const };
    }

    const activation = await activateTenant({
      tenantId: tenant.id,
      reason: "billing_restored",
      actorType: DriveTenantActorType.SYSTEM,
      actorId: "billing-enforcer",
      traceId: input.traceId,
      idempotencyKey: input.idempotencyKey,
      metadata: {
        billingState: input.billingState,
      },
    });

    return {
      ok: true as const,
      tenant: activation.tenant,
      action: activation.changed ? ("activated" as const) : ("unchanged" as const),
    };
  }

  if (input.billingState === "PAST_DUE") {
    const restriction = await restrictTenant({
      tenantId: tenant.id,
      reason: "billing_past_due",
      actorType: DriveTenantActorType.SYSTEM,
      actorId: "billing-enforcer",
      traceId: input.traceId,
      idempotencyKey: input.idempotencyKey,
      metadata: {
        billingState: input.billingState,
      },
    });

    return {
      ok: true as const,
      tenant: restriction.tenant,
      action: restriction.changed ? ("restricted" as const) : ("unchanged" as const),
    };
  }

  const disabled = await disableTenant({
    tenantId: tenant.id,
    reason: "billing_canceled",
    actorType: DriveTenantActorType.SYSTEM,
    actorId: "billing-enforcer",
    traceId: input.traceId,
    idempotencyKey: input.idempotencyKey,
    metadata: {
      billingState: input.billingState,
    },
  });

  return {
    ok: true as const,
    tenant: disabled.tenant,
    action: disabled.changed ? ("disabled" as const) : ("unchanged" as const),
  };
}