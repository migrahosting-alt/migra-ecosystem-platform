/**
 * Worker: Reconcile subscriptions between Stripe and platform.
 * Runs daily or on-demand. Finds drift and fixes it.
 */
import type { BillingContext } from "../context.js";
import { syncSubscriptionFromStripe } from "../subscriptions/index.js";

export async function reconcileSubscriptions(
  ctx: BillingContext,
): Promise<{ checked: number; fixed: number; errors: string[] }> {
  const errors: string[] = [];
  let checked = 0;
  let fixed = 0;

  // Get all active billing accounts
  const accounts = await ctx.db.billingAccount.findMany({
    where: { status: "ACTIVE", stripeCustomerId: { not: null } },
  });

  for (const account of accounts) {
    try {
      const stripeSubscriptions = await ctx.stripe.subscriptions.list({
        customer: account.stripeCustomerId!,
        limit: 100,
        status: "all",
      });

      for (const stripeSub of stripeSubscriptions.data) {
        checked++;
        const platformSub = await ctx.db.billingSubscription.findUnique({
          where: { stripeSubscriptionId: stripeSub.id },
        });

        if (!platformSub) {
          // Missing mirror — sync it
          await syncSubscriptionFromStripe(ctx, stripeSub);
          fixed++;
          continue;
        }

        // Check for status drift
        const stripeStatus = stripeSub.status.toUpperCase();
        if ((platformSub as any).status !== stripeStatus) {
          await syncSubscriptionFromStripe(ctx, stripeSub);
          fixed++;
        }
      }
    } catch (err) {
      errors.push(`Failed to reconcile org ${(account as any).orgId}: ${err}`);
    }
  }

  return { checked, fixed, errors };
}
