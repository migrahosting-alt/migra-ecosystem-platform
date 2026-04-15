import type Stripe from "stripe";
import type { BillingContext } from "../context";
import type { BillingSubscription, ProductFamily, PlanCode, SubscriptionStatus } from "../types";
import { findCatalogPlan } from "../catalog/index";
import { resolveAndSnapshotEntitlements } from "../entitlements/index";

// ─── Helpers ────────────────────────────────────────────────────────

function mapStripeStatus(status: string): SubscriptionStatus {
  const map: Record<string, SubscriptionStatus> = {
    active: "active",
    trialing: "trialing",
    past_due: "past_due",
    paused: "paused",
    canceled: "canceled",
    incomplete: "incomplete",
    incomplete_expired: "incomplete_expired",
    unpaid: "unpaid",
  };
  return map[status] ?? "incomplete";
}

/**
 * Resolve catalog lookup keys to real Stripe price IDs.
 * Stripe's `price` field on subscription items requires the price ID, not the lookup key.
 */
async function resolvePriceIds(
  ctx: BillingContext,
  lookupKeys: string[],
): Promise<Record<string, string>> {
  if (lookupKeys.length === 0) return {};
  const prices = await ctx.stripe.prices.list({ lookup_keys: lookupKeys, limit: lookupKeys.length });
  const map: Record<string, string> = {};
  for (const price of prices.data) {
    if (price.lookup_key) map[price.lookup_key] = price.id;
  }
  return map;
}

// ─── Create Subscription ────────────────────────────────────────────

export interface CreateSubscriptionInput {
  orgId: string;
  billingAccountId: string;
  stripeCustomerId: string;
  productFamily: ProductFamily;
  planCode: PlanCode;
  billingInterval: "month" | "year";
  seatCount?: number;
  trialDays?: number;
  idempotencyKey: string;
}

/**
 * Create a subscription via Stripe API with default_incomplete payment behavior.
 * The subscription and items are mirrored to the platform DB.
 * Entitlements are NOT activated until the webhook confirms payment/activation.
 */
export async function createSubscription(
  ctx: BillingContext,
  input: CreateSubscriptionInput,
): Promise<BillingSubscription> {
  const plan = findCatalogPlan(input.productFamily, input.planCode);
  if (!plan) {
    throw new Error(`Plan not found: ${input.productFamily}/${input.planCode}`);
  }

  // Collect lookup keys for this plan/interval and resolve to Stripe price IDs
  const neededLookupKeys = plan.prices
    .filter(p => p.billingInterval === input.billingInterval)
    .map(p => p.lookupKey);
  const priceIdMap = await resolvePriceIds(ctx, neededLookupKeys);

  // Build Stripe subscription items
  const items: Stripe.SubscriptionCreateParams.Item[] = [];

  for (const catalogPrice of plan.prices) {
    if (catalogPrice.billingInterval !== input.billingInterval) continue;

    const priceId = priceIdMap[catalogPrice.lookupKey];
    if (!priceId) {
      throw new Error(`Stripe price not found for lookup key: ${catalogPrice.lookupKey}`);
    }

    // Reference the pre-seeded Stripe price by its resolved ID
    const item: Stripe.SubscriptionCreateParams.Item = {
      price: priceId,
      metadata: catalogPrice.metadata,
    };

    if (catalogPrice.componentType === "seat") {
      item.quantity = input.seatCount ?? 1;
    } else if (catalogPrice.componentType === "base" || catalogPrice.componentType === "onboarding") {
      item.quantity = 1;
    }
    // metered usage: no quantity

    items.push(item);
  }

  const stripeSubscription = await ctx.stripe.subscriptions.create(
    {
      customer: input.stripeCustomerId,
      items,
      payment_behavior: "default_incomplete",
      expand: ["latest_invoice.payment_intent"],
      metadata: {
        org_id: input.orgId,
        product_family: input.productFamily,
        plan_code: input.planCode,
        platform: "migrateck",
      },
      ...(input.trialDays ? { trial_period_days: input.trialDays } : {}),
    },
    { idempotencyKey: input.idempotencyKey },
  );

  // Mirror to platform DB
  const subscription = await ctx.db.billingSubscription.create({
    data: {
      orgId: input.orgId,
      billingAccountId: input.billingAccountId,
      stripeSubscriptionId: stripeSubscription.id,
      productFamily: input.productFamily,
      planCode: input.planCode,
      status: mapStripeStatus(stripeSubscription.status).toUpperCase(),
      billingInterval: input.billingInterval === "year" ? "YEAR" : "MONTH",
      currentPeriodStart: new Date((stripeSubscription.current_period_start ?? 0) * 1000),
      currentPeriodEnd: new Date((stripeSubscription.current_period_end ?? 0) * 1000),
      trialEndsAt: stripeSubscription.trial_end
        ? new Date(stripeSubscription.trial_end * 1000)
        : null,
    },
  });

  // Mirror subscription items
  for (const si of stripeSubscription.items.data) {
    const componentType = (si.metadata?.billing_component ?? "base").toUpperCase();
    await ctx.db.billingSubscriptionItem.create({
      data: {
        billingSubscriptionId: subscription.id,
        stripeSubscriptionItemId: si.id,
        componentType,
        priceLookupKey: si.price?.lookup_key ?? null,
        quantity: si.quantity ?? null,
        meterName: si.metadata?.usage_dimension ?? null,
      },
    });
  }

  return subscription as BillingSubscription;
}

// ─── Sync Subscription from Stripe Event ────────────────────────────

/**
 * Sync subscription state from a Stripe subscription object (webhook-driven).
 * This is the authoritative path for subscription state changes.
 */
export async function syncSubscriptionFromStripe(
  ctx: BillingContext,
  stripeSubscription: Stripe.Subscription,
): Promise<BillingSubscription> {
  const orgId = stripeSubscription.metadata?.org_id;
  if (!orgId) {
    throw new Error(`Stripe subscription ${stripeSubscription.id} missing org_id metadata`);
  }

  const status = mapStripeStatus(stripeSubscription.status).toUpperCase();

  const subscription = await ctx.db.billingSubscription.upsert({
    where: { stripeSubscriptionId: stripeSubscription.id },
    create: {
      orgId,
      billingAccountId: "", // Will be resolved below
      stripeSubscriptionId: stripeSubscription.id,
      productFamily: stripeSubscription.metadata?.product_family ?? "unknown",
      planCode: stripeSubscription.metadata?.plan_code ?? "unknown",
      status,
      billingInterval: "MONTH",
      currentPeriodStart: new Date((stripeSubscription.current_period_start ?? 0) * 1000),
      currentPeriodEnd: new Date((stripeSubscription.current_period_end ?? 0) * 1000),
      cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
      trialEndsAt: stripeSubscription.trial_end
        ? new Date(stripeSubscription.trial_end * 1000)
        : null,
      pausedAt: stripeSubscription.pause_collection
        ? new Date()
        : null,
      canceledAt: stripeSubscription.canceled_at
        ? new Date(stripeSubscription.canceled_at * 1000)
        : null,
    },
    update: {
      status,
      currentPeriodStart: new Date((stripeSubscription.current_period_start ?? 0) * 1000),
      currentPeriodEnd: new Date((stripeSubscription.current_period_end ?? 0) * 1000),
      cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
      trialEndsAt: stripeSubscription.trial_end
        ? new Date(stripeSubscription.trial_end * 1000)
        : null,
      pausedAt: stripeSubscription.pause_collection
        ? new Date()
        : null,
      canceledAt: stripeSubscription.canceled_at
        ? new Date(stripeSubscription.canceled_at * 1000)
        : null,
    },
  });

  // Resolve billing account for the upsert create case
  if (!subscription.billingAccountId) {
    const account = await ctx.db.billingAccount.findUnique({ where: { orgId } });
    if (account) {
      await ctx.db.billingSubscription.update({
        where: { id: subscription.id },
        data: { billingAccountId: account.id },
      });
    }
  }

  // Re-resolve entitlements whenever subscription state changes
  await resolveAndSnapshotEntitlements(ctx, orgId);

  return subscription as BillingSubscription;
}

// ─── Get Subscriptions ──────────────────────────────────────────────

export async function getSubscriptions(
  ctx: BillingContext,
  orgId: string,
): Promise<BillingSubscription[]> {
  const subscriptions = await ctx.db.billingSubscription.findMany({
    where: { orgId },
    include: { items: true },
  });
  return subscriptions as BillingSubscription[];
}

export async function getSubscription(
  ctx: BillingContext,
  subscriptionId: string,
): Promise<BillingSubscription | null> {
  const subscription = await ctx.db.billingSubscription.findUnique({
    where: { id: subscriptionId },
    include: { items: true },
  });
  return subscription as BillingSubscription | null;
}

// ─── Change Plan ────────────────────────────────────────────────────

export interface ChangePlanInput {
  subscriptionId: string;
  newPlanCode: PlanCode;
  newBillingInterval?: "month" | "year";
  idempotencyKey: string;
}

/**
 * Upgrade or downgrade a subscription. Stripe handles proration.
 */
export async function changePlan(
  ctx: BillingContext,
  input: ChangePlanInput,
): Promise<BillingSubscription> {
  const subscription = await ctx.db.billingSubscription.findUnique({
    where: { id: input.subscriptionId },
    include: { items: true },
  });
  if (!subscription) {
    throw new Error(`Subscription ${input.subscriptionId} not found`);
  }

  const newPlan = findCatalogPlan(subscription.productFamily, input.newPlanCode);
  if (!newPlan) {
    throw new Error(`Plan not found: ${subscription.productFamily}/${input.newPlanCode}`);
  }

  const interval = input.newBillingInterval ?? subscription.billingInterval.toLowerCase();

  // Resolve lookup keys to Stripe price IDs for new plan items
  const neededLookupKeys = newPlan.prices
    .filter(p => p.billingInterval === interval)
    .map(p => p.lookupKey);
  const priceIdMap = await resolvePriceIds(ctx, neededLookupKeys);

  // Build new items for Stripe
  const newItems: Stripe.SubscriptionUpdateParams.Item[] = [];

  // Remove old items
  for (const item of (subscription as any).items ?? []) {
    if (item.stripeSubscriptionItemId) {
      newItems.push({ id: item.stripeSubscriptionItemId, deleted: true });
    }
  }

  // Add new plan items
  for (const catalogPrice of newPlan.prices) {
    if (catalogPrice.billingInterval !== interval) continue;

    const priceId = priceIdMap[catalogPrice.lookupKey];
    if (!priceId) {
      throw new Error(`Stripe price not found for lookup key: ${catalogPrice.lookupKey}`);
    }

    newItems.push({
      price: priceId,
      ...(catalogPrice.componentType === "base" ? { quantity: 1 } : {}),
    });
  }

  await ctx.stripe.subscriptions.update(
    subscription.stripeSubscriptionId!,
    {
      items: newItems,
      proration_behavior: "always_invoice",
      metadata: {
        plan_code: input.newPlanCode,
      },
    },
    { idempotencyKey: input.idempotencyKey },
  );

  // Platform state will be synced via webhook
  const updated = await ctx.db.billingSubscription.update({
    where: { id: input.subscriptionId },
    data: { planCode: input.newPlanCode },
  });

  return updated as BillingSubscription;
}

// ─── Change Seats ───────────────────────────────────────────────────

export interface ChangeSeatsInput {
  subscriptionId: string;
  newSeatCount: number;
  idempotencyKey: string;
}

export async function changeSeats(
  ctx: BillingContext,
  input: ChangeSeatsInput,
): Promise<void> {
  const subscription = await ctx.db.billingSubscription.findUnique({
    where: { id: input.subscriptionId },
    include: { items: true },
  });
  if (!subscription) {
    throw new Error(`Subscription ${input.subscriptionId} not found`);
  }

  // Find the seat item
  const seatItem = ((subscription as any).items ?? []).find(
    (item: any) => item.componentType === "SEAT",
  );
  if (!seatItem?.stripeSubscriptionItemId) {
    throw new Error("No seat item found on this subscription");
  }

  await ctx.stripe.subscriptionItems.update(
    seatItem.stripeSubscriptionItemId,
    { quantity: input.newSeatCount, proration_behavior: "always_invoice" },
    { idempotencyKey: input.idempotencyKey },
  );

  await ctx.db.billingSubscriptionItem.update({
    where: { id: seatItem.id },
    data: { quantity: input.newSeatCount },
  });
}

// ─── Pause / Resume ─────────────────────────────────────────────────

export async function pauseSubscription(
  ctx: BillingContext,
  subscriptionId: string,
  idempotencyKey: string,
): Promise<void> {
  const subscription = await ctx.db.billingSubscription.findUnique({
    where: { id: subscriptionId },
  });
  if (!subscription?.stripeSubscriptionId) {
    throw new Error(`Subscription ${subscriptionId} not found`);
  }

  await ctx.stripe.subscriptions.update(
    subscription.stripeSubscriptionId,
    { pause_collection: { behavior: "void" } },
    { idempotencyKey },
  );

  await ctx.db.billingSubscription.update({
    where: { id: subscriptionId },
    data: { pausedAt: new Date() },
  });
}

export async function resumeSubscription(
  ctx: BillingContext,
  subscriptionId: string,
  idempotencyKey: string,
): Promise<void> {
  const subscription = await ctx.db.billingSubscription.findUnique({
    where: { id: subscriptionId },
  });
  if (!subscription?.stripeSubscriptionId) {
    throw new Error(`Subscription ${subscriptionId} not found`);
  }

  await ctx.stripe.subscriptions.update(
    subscription.stripeSubscriptionId,
    { pause_collection: "" as any },
    { idempotencyKey },
  );

  await ctx.db.billingSubscription.update({
    where: { id: subscriptionId },
    data: { pausedAt: null, status: "ACTIVE" },
  });
}

// ─── Cancel ─────────────────────────────────────────────────────────

export interface CancelSubscriptionInput {
  subscriptionId: string;
  cancelImmediately?: boolean;
  idempotencyKey: string;
}

export async function cancelSubscription(
  ctx: BillingContext,
  input: CancelSubscriptionInput,
): Promise<void> {
  const subscription = await ctx.db.billingSubscription.findUnique({
    where: { id: input.subscriptionId },
  });
  if (!subscription?.stripeSubscriptionId) {
    throw new Error(`Subscription ${input.subscriptionId} not found`);
  }

  if (input.cancelImmediately) {
    await ctx.stripe.subscriptions.cancel(
      subscription.stripeSubscriptionId,
      { prorate: true },
      { idempotencyKey: input.idempotencyKey },
    );

    await ctx.db.billingSubscription.update({
      where: { id: input.subscriptionId },
      data: { status: "CANCELED", canceledAt: new Date() },
    });
  } else {
    await ctx.stripe.subscriptions.update(
      subscription.stripeSubscriptionId,
      { cancel_at_period_end: true },
      { idempotencyKey: input.idempotencyKey },
    );

    await ctx.db.billingSubscription.update({
      where: { id: input.subscriptionId },
      data: { cancelAtPeriodEnd: true },
    });
  }
}
