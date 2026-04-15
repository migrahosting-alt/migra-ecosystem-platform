/**
 * Worker: Emit unreported usage events to Stripe.
 * Runs on a schedule (e.g., every 5 minutes).
 *
 * Internal usage ledger → Stripe usage reporting.
 */
import type { BillingContext } from "../context.js";
import { getUnreportedUsage, markUsageReported } from "../usage/index.js";

export async function emitUsage(ctx: BillingContext): Promise<{ reported: number; errors: number }> {
  const events = await getUnreportedUsage(ctx, 200);
  let reported = 0;
  let errors = 0;

  for (const event of events) {
    try {
      // Find the billing account to get Stripe customer ID
      const billingAccount = await ctx.db.billingAccount.findUnique({
        where: { orgId: event.orgId },
      });

      if (!billingAccount?.stripeCustomerId) {
        errors++;
        continue;
      }

      // Report usage to Stripe via Billing Meter Events (Stripe v17+)
      await ctx.stripe.billing.meterEvents.create(
        {
          event_name: event.meterName,
          payload: {
            stripe_customer_id: billingAccount.stripeCustomerId,
            value: String(event.quantity),
          },
          timestamp: Math.floor(event.windowEnd.getTime() / 1000),
          identifier: `usage_${event.id}`,
        },
      );

      await markUsageReported(ctx, [event.id]);
      reported++;
    } catch {
      errors++;
    }
  }

  return { reported, errors };
}
