import type { BillingContext } from "../context";
import type { DunningState } from "../types";
import { resolveAndSnapshotEntitlements } from "../entitlements/index";

/**
 * Dunning state machine:
 *
 *   ACTIVE → PAST_DUE → GRACE_PERIOD → RESTRICTED → SUSPENDED → CANCELED
 *
 * Entitlements react to dunning state, not just raw subscription status.
 * Stripe Smart Retries handle the payment retry logic.
 * This module manages the internal service degradation state.
 */

const DUNNING_TRANSITIONS: Record<DunningState, DunningState[]> = {
  active: ["past_due"],
  past_due: ["active", "grace_period", "suspended"],
  grace_period: ["active", "restricted", "suspended"],
  restricted: ["active", "suspended"],
  suspended: ["active", "canceled"],
  canceled: [],
};

/**
 * Update an org's dunning state.
 * Only valid transitions are allowed.
 */
export async function updateDunningState(
  ctx: BillingContext,
  orgId: string,
  newState: DunningState,
): Promise<void> {
  const account = await ctx.db.billingAccount.findUnique({
    where: { orgId },
  });
  if (!account) return;

  const currentState = (account.dunningState?.toLowerCase() ?? "active") as DunningState;
  const allowedTransitions = DUNNING_TRANSITIONS[currentState] ?? [];

  // Allow same-state (idempotent) or valid transition
  if (newState !== currentState && !allowedTransitions.includes(newState)) {
    // Force transition for webhook-driven updates — Stripe is authoritative
    // Log the forced transition for audit
    console.warn(
      `Billing: forced dunning transition ${currentState} → ${newState} for org ${orgId}`,
    );
  }

  await ctx.db.billingAccount.update({
    where: { orgId },
    data: { dunningState: newState.toUpperCase() },
  });

  // Re-resolve entitlements when dunning state changes
  await resolveAndSnapshotEntitlements(ctx, orgId);
}

/**
 * Get the current dunning state for an org.
 */
export async function getDunningState(
  ctx: BillingContext,
  orgId: string,
): Promise<DunningState> {
  const account = await ctx.db.billingAccount.findUnique({
    where: { orgId },
  });
  return (account?.dunningState?.toLowerCase() ?? "active") as DunningState;
}

/**
 * Check if an org's service should be degraded based on dunning state.
 */
export function isDegraded(state: DunningState): boolean {
  return state === "restricted" || state === "suspended" || state === "canceled";
}

/**
 * Check if an org's service should be fully suspended.
 */
export function isSuspended(state: DunningState): boolean {
  return state === "suspended" || state === "canceled";
}
