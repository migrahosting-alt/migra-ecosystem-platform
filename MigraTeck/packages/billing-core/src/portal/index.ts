import type { BillingContext } from "../context.js";

/**
 * Create a Stripe Customer Portal session for self-service management.
 */
export async function createPortalSession(
  ctx: BillingContext,
  orgId: string,
  returnUrl: string,
): Promise<{ url: string }> {
  const account = await ctx.db.billingAccount.findUnique({
    where: { orgId },
  });

  if (!account?.stripeCustomerId) {
    throw new Error(`No billing account or Stripe customer for org ${orgId}`);
  }

  const session = await ctx.stripe.billingPortal.sessions.create({
    customer: account.stripeCustomerId,
    return_url: returnUrl,
  });

  return { url: session.url };
}
