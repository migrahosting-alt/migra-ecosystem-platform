/**
 * Worker: Recover failed webhook events by re-fetching from Stripe.
 */
import type { BillingContext } from "../context.js";
import { retryFailedWebhooks } from "../support-actions/index.js";

export async function recoverFailedWebhooks(
  ctx: BillingContext,
  limit?: number,
): Promise<{ retried: number; succeeded: number; failed: number }> {
  return retryFailedWebhooks(ctx, limit);
}
