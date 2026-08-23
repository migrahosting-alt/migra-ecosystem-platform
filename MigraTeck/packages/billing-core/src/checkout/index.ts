import type Stripe from "stripe";
import type { BillingContext } from "../context.js";
import { findCatalogPlan } from "../catalog/index.js";
import { getOrCreateBillingAccount } from "../customers/index.js";
import type { ProductFamily, PlanCode, BillingInterval } from "../types.js";

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

// ── Guest / explicit-price checkout (platform-agnostic) ──────────────
export interface GuestCheckoutLineItem { name: string; amountCents: number; quantity?: number; interval?: BillingInterval; intervalCount?: number; }
export interface CreateGuestCheckoutInput {
  platform: string;
  billingEmail: string;
  mode: "payment" | "subscription";
  lineItems: GuestCheckoutLineItem[];
  successUrl: string;
  cancelUrl: string;
  trialDays?: number;
  metadata?: Record<string, string>;
}

export async function createGuestCheckoutSession(
  ctx: BillingContext,
  input: CreateGuestCheckoutInput,
): Promise<CheckoutSessionResult> {
  const line_items = input.lineItems.map((li) => ({
    quantity: li.quantity ?? 1,
    price_data: {
      currency: "usd",
      unit_amount: li.amountCents,
      product_data: { name: li.name },
      ...(input.mode === "subscription" && li.interval ? { recurring: { interval: li.interval, ...(li.intervalCount ? { interval_count: li.intervalCount } : {}) } } : {}),
    },
  })) as Stripe.Checkout.SessionCreateParams.LineItem[];

  const session = await ctx.stripe.checkout.sessions.create({
    mode: input.mode,
    customer_email: input.billingEmail,
    ...(input.mode === "payment" ? { customer_creation: "always" as const } : {}),
    line_items,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    metadata: { platform: input.platform, billing_email: input.billingEmail.toLowerCase(), guest: "1", ...input.metadata },
    ...(input.mode === "subscription" ? { subscription_data: { ...(input.trialDays ? { trial_period_days: input.trialDays } : {}), metadata: { platform: input.platform, billing_email: input.billingEmail.toLowerCase(), guest: "1", ...input.metadata } } } : {}),
    automatic_tax: { enabled: true },
    allow_promotion_codes: true,
  });

  return { sessionId: session.id, url: session.url! };
}
