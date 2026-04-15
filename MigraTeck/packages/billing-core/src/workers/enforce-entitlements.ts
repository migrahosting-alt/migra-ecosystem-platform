/**
 * Worker: Enforce entitlements based on current billing state.
 * Runs periodically to catch any drift between subscriptions and entitlements.
 */
import type { BillingContext } from "../context";
import { resolveAndSnapshotEntitlements } from "../entitlements/index";

export async function enforceEntitlements(
  ctx: BillingContext,
): Promise<{ checked: number; refreshed: number }> {
  let checked = 0;
  let refreshed = 0;

  // Get all active billing accounts
  const accounts = await ctx.db.billingAccount.findMany({
    where: { status: "ACTIVE" },
  });

  for (const account of accounts) {
    checked++;
    try {
      await resolveAndSnapshotEntitlements(ctx, (account as any).orgId);
      refreshed++;
    } catch {
      // Continue processing other accounts
    }
  }

  return { checked, refreshed };
}
