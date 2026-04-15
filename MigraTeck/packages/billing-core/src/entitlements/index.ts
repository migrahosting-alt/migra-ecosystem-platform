import type { BillingContext } from "../context";
import { findCatalogPlan } from "../catalog/index";
import type { ProductFamily, PlanCode } from "../types";
import type { OrgEntitlements } from "./types";

export type { OrgEntitlements, EntitlementKey } from "./types";

/**
 * Resolve the effective entitlements for an org by merging:
 * 1. Entitlements from active/trialing subscriptions (from catalog plan mapping)
 * 2. Manual overrides (from BillingEntitlementSnapshot with source_type=manual_override)
 * 3. Promotional grants
 *
 * Higher values win for numeric limits. True wins for booleans.
 * -1 (unlimited) always wins.
 */
export async function resolveEntitlements(
  ctx: BillingContext,
  orgId: string,
): Promise<OrgEntitlements> {
  const merged: OrgEntitlements = {};

  // 1. Gather entitlements from active subscriptions
  const subscriptions = await ctx.db.billingSubscription.findMany({
    where: {
      orgId,
      status: { in: ["ACTIVE", "TRIALING"] },
    },
  });

  for (const sub of subscriptions) {
    const plan = findCatalogPlan(
      sub.productFamily as ProductFamily,
      sub.planCode as PlanCode,
    );
    if (!plan) continue;

    for (const [key, value] of Object.entries(plan.entitlements)) {
      mergeEntitlementValue(merged, key, value);
    }
  }

  // 2. Apply manual overrides (most recent per org)
  const overrides = await ctx.db.billingEntitlementSnapshot.findMany({
    where: {
      orgId,
      sourceType: "MANUAL_OVERRIDE",
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    orderBy: { effectiveAt: "desc" },
    take: 1,
  });

  if (overrides.length > 0) {
    const overrideEntitlements = overrides[0].entitlementsJson as Record<string, unknown>;
    for (const [key, value] of Object.entries(overrideEntitlements)) {
      if (value !== undefined && value !== null) {
        // Manual overrides always win
        (merged as Record<string, unknown>)[key] = value;
      }
    }
  }

  // 3. Apply promotional grants
  const promos = await ctx.db.billingEntitlementSnapshot.findMany({
    where: {
      orgId,
      sourceType: "PROMOTIONAL",
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
  });

  for (const promo of promos) {
    const promoEntitlements = promo.entitlementsJson as Record<string, unknown>;
    for (const [key, value] of Object.entries(promoEntitlements)) {
      mergeEntitlementValue(merged, key, value);
    }
  }

  return merged;
}

/**
 * Resolve entitlements and persist the snapshot to the DB.
 */
export async function resolveAndSnapshotEntitlements(
  ctx: BillingContext,
  orgId: string,
): Promise<OrgEntitlements> {
  const entitlements = await resolveEntitlements(ctx, orgId);

  const account = await ctx.db.billingAccount.findUnique({ where: { orgId } });
  if (!account) return entitlements;

  await ctx.db.billingEntitlementSnapshot.create({
    data: {
      orgId,
      billingAccountId: account.id,
      sourceType: "SUBSCRIPTION",
      sourceId: orgId,
      entitlementsJson: entitlements,
      effectiveAt: new Date(),
    },
  });

  return entitlements;
}

/**
 * Get the most recent entitlement snapshot for an org.
 * This is the fast path — apps call this rather than re-resolving every time.
 */
export async function getOrgEntitlements(
  ctx: BillingContext,
  orgId: string,
): Promise<OrgEntitlements> {
  const snapshot = await ctx.db.billingEntitlementSnapshot.findFirst({
    where: { orgId },
    orderBy: { effectiveAt: "desc" },
  });

  if (!snapshot) {
    return {};
  }

  return snapshot.entitlementsJson as OrgEntitlements;
}

/**
 * Check if an org has a specific entitlement enabled / meets a threshold.
 */
export function checkEntitlement(
  entitlements: OrgEntitlements,
  key: string,
  requiredValue?: number,
): boolean {
  const value = (entitlements as Record<string, unknown>)[key];

  if (value === undefined || value === null) return false;

  if (typeof value === "boolean") return value;

  if (typeof value === "number") {
    if (value === -1) return true; // unlimited
    if (requiredValue !== undefined) return value >= requiredValue;
    return value > 0;
  }

  // String values are truthy
  return true;
}

// ─── Internal Helpers ───────────────────────────────────────────────

function mergeEntitlementValue(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  const existing = target[key];

  if (existing === undefined || existing === null) {
    target[key] = value;
    return;
  }

  // -1 (unlimited) always wins
  if (value === -1 || existing === -1) {
    target[key] = -1;
    return;
  }

  // Higher numeric values win
  if (typeof value === "number" && typeof existing === "number") {
    target[key] = Math.max(existing, value);
    return;
  }

  // true wins over false
  if (typeof value === "boolean" && typeof existing === "boolean") {
    target[key] = existing || value;
    return;
  }

  // Default: new value wins
  target[key] = value;
}
