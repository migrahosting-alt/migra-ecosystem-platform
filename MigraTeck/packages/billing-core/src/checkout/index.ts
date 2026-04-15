import type Stripe from "stripe";
import type { BillingContext } from "../context";
import { findCatalogPlan } from "../catalog/index";
import { getOrCreateBillingAccount } from "../customers/index";
import type { ProductFamily, PlanCode, BillingInterval } from "../types";

export interface CreateCheckoutSessionInput {
  orgId: string;
  orgName: string;
  billingEmail: string;
  productFamily: ProductFamily;
  planCode: PlanCode;
  billingInterval: BillingInterval;
  seatCount?: number;
  successUrl: string;
  cancelUrl: string;
  trialDays?: number;
  metadata?: Record<string, string>;
}

export interface CheckoutSessionResult {
  sessionId: string;
  url: string;
}

/**
 * Create a Stripe Checkout Session for a new subscription.
 * Uses payment_behavior=default_incomplete via Checkout's built-in handling.
 */
export async function createCheckoutSession(
  ctx: BillingContext,
  input: CreateCheckoutSessionInput,
): Promise<CheckoutSessionResult> {
  const plan = findCatalogPlan(input.productFamily, input.planCode);
  if (!plan) {
    throw new Error(`Plan not found: ${input.productFamily}/${input.planCode}`);
  }

  // Ensure billing account exists
  const account = await getOrCreateBillingAccount(ctx, {
    orgId: input.orgId,
    orgName: input.orgName,
    billingEmail: input.billingEmail,
  });

  // Build line items from catalog prices matching the requested interval
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];

  for (const catalogPrice of plan.prices) {
    if (catalogPrice.billingInterval !== input.billingInterval) continue;

    const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = {
      price_data: {
        currency: "usd",
        product_data: {
          name: `${input.productFamily} ${plan.name} — ${catalogPrice.componentType}`,
          metadata: catalogPrice.metadata,
        },
        recurring: {
          interval: input.billingInterval === "year" ? "year" : "month",
        },
        ...(catalogPrice.unitAmount !== null ? { unit_amount: catalogPrice.unitAmount } : {}),
      },
    };

    if (catalogPrice.componentType === "seat") {
      lineItem.quantity = input.seatCount ?? 1;
    } else if (catalogPrice.componentType === "base") {
      lineItem.quantity = 1;
    }
    // Metered usage prices are added to the subscription after creation

    if (catalogPrice.componentType !== "usage") {
      lineItems.push(lineItem);
    }
  }

  if (lineItems.length === 0) {
    throw new Error(`No prices found for ${input.productFamily}/${input.planCode} at ${input.billingInterval} interval`);
  }

  const trialDays = input.trialDays ?? plan.trialDays;

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    customer: account.stripeCustomerId!,
    line_items: lineItems,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    metadata: {
      org_id: input.orgId,
      product_family: input.productFamily,
      plan_code: input.planCode,
      billing_interval: input.billingInterval,
      platform: "migrateck",
      ...input.metadata,
    },
    ...(trialDays ? { subscription_data: { trial_period_days: trialDays } } : {}),
    automatic_tax: { enabled: true },
    tax_id_collection: { enabled: true },
    allow_promotion_codes: true,
  };

  const session = await ctx.stripe.checkout.sessions.create(sessionParams);

  return {
    sessionId: session.id,
    url: session.url!,
  };
}
