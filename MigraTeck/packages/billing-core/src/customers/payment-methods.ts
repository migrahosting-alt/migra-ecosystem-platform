import type Stripe from "stripe";
import type { BillingContext } from "../context";

/**
 * Sync a payment method from Stripe (webhook-driven).
 */
export async function syncPaymentMethodFromStripe(
  ctx: BillingContext,
  stripePaymentMethod: Stripe.PaymentMethod,
  customerId: string,
  isDetach?: boolean,
): Promise<void> {
  const account = await ctx.db.billingAccount.findUnique({
    where: { stripeCustomerId: customerId },
  });

  if (!account) return;

  if (isDetach) {
    // Try to delete the payment method record
    const existing = await ctx.db.billingPaymentMethod.findUnique({
      where: { stripePaymentMethodId: stripePaymentMethod.id },
    });
    if (existing) {
      await ctx.db.billingPaymentMethod.delete({
        where: { id: existing.id },
      });
    }
    return;
  }

  const card = stripePaymentMethod.card;

  await ctx.db.billingPaymentMethod.upsert({
    where: { stripePaymentMethodId: stripePaymentMethod.id },
    create: {
      orgId: account.orgId,
      billingAccountId: account.id,
      stripePaymentMethodId: stripePaymentMethod.id,
      type: stripePaymentMethod.type,
      brand: card?.brand ?? null,
      last4: card?.last4 ?? null,
      expMonth: card?.exp_month ?? null,
      expYear: card?.exp_year ?? null,
      isDefault: false,
    },
    update: {
      brand: card?.brand ?? null,
      last4: card?.last4 ?? null,
      expMonth: card?.exp_month ?? null,
      expYear: card?.exp_year ?? null,
    },
  });
}

/**
 * List payment methods for an org.
 */
export async function getPaymentMethods(
  ctx: BillingContext,
  orgId: string,
): Promise<any[]> {
  return ctx.db.billingPaymentMethod.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
  });
}
