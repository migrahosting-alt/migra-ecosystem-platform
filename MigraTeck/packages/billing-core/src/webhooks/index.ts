import type Stripe from "stripe";
import type { BillingContext } from "../context.js";
import { syncSubscriptionFromStripe } from "../subscriptions/index.js";
import { syncInvoiceFromStripe } from "../invoices/index.js";
import { syncPaymentMethodFromStripe } from "../customers/payment-methods.js";
import { resolveAndSnapshotEntitlements } from "../entitlements/index.js";
import { updateDunningState } from "../dunning/index.js";
import type { WebhookEventStatus } from "../types.js";

// ─── Supported Webhook Events ───────────────────────────────────────

const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.created",
  "invoice.finalized",
  "invoice.paid",
  "invoice.payment_failed",
  "payment_method.attached",
  "payment_method.detached",
  "customer.updated",
  "entitlements.active_entitlement_summary.updated",
]);

// ─── Signature Verification ─────────────────────────────────────────

export function constructEvent(
  ctx: BillingContext,
  payload: string | Buffer,
  signature: string,
  webhookSecret: string,
): Stripe.Event {
  return ctx.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
}

// ─── Main Webhook Handler ───────────────────────────────────────────

export interface WebhookResult {
  eventId: string;
  type: string;
  status: WebhookEventStatus;
  error?: string;
}

/**
 * Process a verified Stripe webhook event.
 * - Deduplicates by stripe event ID
 * - Stores raw event
 * - Routes to appropriate handler
 * - Updates processing status
 */
export async function processWebhookEvent(
  ctx: BillingContext,
  event: Stripe.Event,
): Promise<WebhookResult> {
  // Deduplicate: check if we've already processed this event
  const existing = await ctx.db.billingWebhookEvent.findUnique({
    where: { stripeEventId: event.id },
  });

  if (existing?.status === "PROCESSED") {
    return { eventId: event.id, type: event.type, status: "processed" };
  }

  // Store raw event
  const webhookEvent = existing
    ? existing
    : await ctx.db.billingWebhookEvent.create({
        data: {
          stripeEventId: event.id,
          type: event.type,
          status: "PENDING",
          payloadJson: event as unknown as Record<string, unknown>,
        },
      });

  // Skip unhandled event types
  if (!HANDLED_EVENTS.has(event.type)) {
    await ctx.db.billingWebhookEvent.update({
      where: { id: webhookEvent.id },
      data: { status: "SKIPPED", processedAt: new Date() },
    });
    return { eventId: event.id, type: event.type, status: "skipped" };
  }

  try {
    await routeEvent(ctx, event);

    await ctx.db.billingWebhookEvent.update({
      where: { id: webhookEvent.id },
      data: { status: "PROCESSED", processedAt: new Date() },
    });

    return { eventId: event.id, type: event.type, status: "processed" };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    await ctx.db.billingWebhookEvent.update({
      where: { id: webhookEvent.id },
      data: { status: "FAILED", errorMessage, processedAt: new Date() },
    });

    return { eventId: event.id, type: event.type, status: "failed", error: errorMessage };
  }
}

// ─── Event Router ───────────────────────────────────────────────────

async function routeEvent(ctx: BillingContext, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    // ── Checkout ───────────────────────────────────────────────
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "subscription" && session.subscription) {
        const subId = typeof session.subscription === "string"
          ? session.subscription
          : session.subscription.id;
        const stripeSubscription = await ctx.stripe.subscriptions.retrieve(subId);
        await syncSubscriptionFromStripe(ctx, stripeSubscription);
      }
      break;
    }

    // ── Subscriptions ─────────────────────────────────────────
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed": {
      const subscription = event.data.object as Stripe.Subscription;
      await syncSubscriptionFromStripe(ctx, subscription);

      // Update dunning state based on subscription status
      const orgId = subscription.metadata?.org_id;
      if (orgId) {
        if (subscription.status === "past_due") {
          await updateDunningState(ctx, orgId, "past_due");
        } else if (subscription.status === "unpaid") {
          await updateDunningState(ctx, orgId, "suspended");
        } else if (subscription.status === "active") {
          await updateDunningState(ctx, orgId, "active");
        }
      }
      break;
    }

    // ── Invoices ──────────────────────────────────────────────
    case "invoice.created":
    case "invoice.finalized":
    case "invoice.paid":
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      await syncInvoiceFromStripe(ctx, invoice);

      // Failed payment triggers dunning
      if (event.type === "invoice.payment_failed") {
        const orgId = invoice.metadata?.org_id;
        if (orgId) {
          await updateDunningState(ctx, orgId, "past_due");
        }
      }
      break;
    }

    // ── Payment Methods ───────────────────────────────────────
    case "payment_method.attached":
    case "payment_method.detached": {
      const pm = event.data.object as Stripe.PaymentMethod;
      if (pm.customer) {
        const customerId = typeof pm.customer === "string" ? pm.customer : pm.customer.id;
        await syncPaymentMethodFromStripe(ctx, pm, customerId, event.type === "payment_method.detached");
      }
      break;
    }

    // ── Customer ──────────────────────────────────────────────
    case "customer.updated": {
      // Customer updates are informational — we track state via account, not customer
      break;
    }

    // ── Stripe Entitlements ───────────────────────────────────
    case "entitlements.active_entitlement_summary.updated": {
      const summary = event.data.object as unknown as { customer: string };
      const customerId = typeof summary.customer === "string" ? summary.customer : "";
      if (customerId) {
        const account = await ctx.db.billingAccount.findUnique({
          where: { stripeCustomerId: customerId },
        });
        if (account) {
          await resolveAndSnapshotEntitlements(ctx, account.orgId);
        }
      }
      break;
    }
  }
}
