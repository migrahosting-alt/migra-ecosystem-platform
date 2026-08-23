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
  "checkout.session.expired",
  "payment_intent.payment_failed",
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
async function bridgeGuestOrderToPanel(
  session: Stripe.Checkout.Session,
  eventId: string
): Promise<void> {
  if (process.env["MIGRAPAY_ORDER_BRIDGE_ENABLED"] !== "1") return;
  const url = process.env["PANEL_ORDERS_WEBHOOK_URL"] || "";
  const token = process.env["PANEL_ORDERS_WEBHOOK_TOKEN"] || "";
  if (!url || !token) { console.warn("[guest-bridge] missing PANEL_ORDERS_WEBHOOK_URL/TOKEN"); return; }
  const md = (session.metadata || {}) as Record<string, string>;
  let rawItems: any[] = [];
  try { rawItems = JSON.parse(md["order_items"] || "[]"); } catch { rawItems = []; }
  if (!Array.isArray(rawItems) || rawItems.length === 0) { console.warn("[guest-bridge] no order_items for " + session.id); return; }
  const email = String(md["billing_email"] || session.customer_email || "").toLowerCase();
  if (!email) { console.warn("[guest-bridge] no email for " + session.id); return; }
  const items = rawItems.map((it: any) => ({
    id: String(it.i || it.id || ""),
    productId: it.p || it.productId || undefined,
    name: it.n || it.name || undefined,
    billingCycle: it.c || it.billingCycle || undefined,
    quantity: Number(it.q || it.quantity || 1),
    amount: typeof (it.a ?? it.amount) === "number" ? (it.a ?? it.amount) : undefined,
    provisioningType: it.t || it.provisioningType || undefined,
  })).filter((x: any) => x.id);
  const payload = {
    customer: { email, fullName: md["customer_name"] || undefined, company: md["customer_company"] || undefined, phone: md["customer_phone"] || undefined },
    customerEmail: email,
    items,
    currency: session.currency || "usd",
    totalAmountCents: typeof session.amount_total === "number" ? session.amount_total : undefined,
    status: "paid",
    stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : (typeof session.subscription === "string" ? session.subscription : undefined),
    metadata: { source: "migrapay-guest", stripe_session: session.id, stripe_event: eventId },
  };
  try {
    const _fetch: any = (globalThis as any).fetch;
    const res = await _fetch(url, { method: "POST", headers: { "content-type": "application/json", "authorization": "Bearer " + token, "x-internal-key": token }, body: JSON.stringify(payload) });
    const txt = await res.text().catch(() => "");
    console.log("[guest-bridge] panel " + res.status + " session=" + session.id + " body=" + String(txt).slice(0, 300));
  } catch (e: any) {
    console.error("[guest-bridge] POST failed " + session.id + ": " + (e && e.message ? e.message : ""));
  }
}

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
          payloadJson: { eventId: event.id, type: event.type } as unknown as Record<string, unknown>, // redacted: no raw Stripe payload (safe-labels policy)
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
      if (session.metadata && session.metadata.guest === "1") {
        await bridgeGuestOrderToPanel(session, event.id);
      }
      if (session.mode === "subscription" && session.subscription) {
        const subId = typeof session.subscription === "string"
          ? session.subscription
          : session.subscription.id;
        const stripeSubscription = await ctx.stripe.subscriptions.retrieve(subId);
        if (stripeSubscription.metadata && stripeSubscription.metadata.guest === "1") {
          console.log("[guest-checkout] paid subscription " + stripeSubscription.id + " platform=" + (stripeSubscription.metadata.platform || "") + " email=" + (stripeSubscription.metadata.billing_email || "") + " customer=" + String(stripeSubscription.customer));
        } else {
          await syncSubscriptionFromStripe(ctx, stripeSubscription);
        }
      } else if (session.mode === "payment" && session.metadata?.kind === "renewal") {
        await handleRenewalCompleted(ctx, session, event.id);
      }
      break;
    }

    // Renewal checkout outcomes (Option A: MigraPay records payment truth only)
    case "checkout.session.expired": {
      const xs = event.data.object as Stripe.Checkout.Session;
      const xmd = xs.metadata || {};
      if (xmd.kind === "renewal" && xmd.externalRef && xmd.serviceEntitlementId) {
        const acct = await ctx.db.billingAccount.findFirst({ where: { externalRef: xmd.externalRef } });
        if (acct) {
          await recordRenewalOutcome(ctx, {
            billingAccountId: acct.id,
            externalRef: xmd.externalRef,
            serviceEntitlementId: xmd.serviceEntitlementId,
            status: "expired",
            amountCents: xmd.amount_cents ? Number(xmd.amount_cents) : null,
            currency: xmd.currency || null,
            stripeEventId: event.id,
          });
        }
      }
      break;
    }

    case "payment_intent.payment_failed": {
      const pi = event.data.object as Stripe.PaymentIntent;
      const pmd = pi.metadata || {};
      if (pmd.kind === "renewal" && pmd.externalRef && pmd.serviceEntitlementId) {
        const rawCode = pi.last_payment_error?.code || pi.last_payment_error?.decline_code || "";
        const safeCode = mapStripeFailureToSafeCode(rawCode);
        const acct = await ctx.db.billingAccount.findFirst({ where: { externalRef: pmd.externalRef } });
        if (acct) {
          await recordRenewalOutcome(ctx, {
            billingAccountId: acct.id,
            externalRef: pmd.externalRef,
            serviceEntitlementId: pmd.serviceEntitlementId,
            status: "failed",
            failureCode: safeCode,
            failureMessageCode: safeCode,
            amountCents: typeof pi.amount === "number" ? pi.amount : (pmd.amount_cents ? Number(pmd.amount_cents) : null),
            currency: pi.currency || pmd.currency || null,
            stripeEventId: event.id,
          });
        }
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
      if (subscription.metadata && subscription.metadata.guest === "1") {
        console.log("[guest-checkout] subscription event " + event.type + " " + subscription.id);
        break;
      }
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


// Renewal Outcome Helpers (Option A)

type RenewalOutcomeRecord = {
  billingAccountId: string;
  externalRef: string;
  serviceEntitlementId: string;
  status: "pending" | "paid" | "failed" | "expired" | "unknown";
  amountCents?: number | null;
  currency?: string | null;
  failureCode?: string | null;
  failureMessageCode?: string | null;
  paidAt?: Date | null;
  stripeEventId?: string | null;
};

async function handleRenewalCompleted(ctx: BillingContext, session: Stripe.Checkout.Session, eventId: string): Promise<void> {
  const md = session.metadata || {};
  const externalRef = md.externalRef || "";
  const serviceEntitlementId = md.serviceEntitlementId || "";
  if (!externalRef || !serviceEntitlementId || !md.amount_cents || !md.currency) {
    console.warn(JSON.stringify({ scope: "renewal_outcome", status: "missing_metadata" }));
    return;
  }
  const acct = await ctx.db.billingAccount.findFirst({ where: { externalRef } });
  if (!acct || !acct.stripeCustomerId) {
    console.warn(JSON.stringify({ scope: "renewal_outcome", status: "account_unresolved" }));
    return;
  }
  const sessionCustomer = typeof session.customer === "string" ? session.customer : (session.customer?.id || "");
  const customerOk = sessionCustomer === acct.stripeCustomerId;
  const amountOk = typeof session.amount_total === "number" && session.amount_total === Number(md.amount_cents);
  const currencyOk = (session.currency || "") === md.currency;
  const paidOk = session.payment_status === "paid";
  if (!(customerOk && amountOk && currencyOk && paidOk)) {
    console.warn(JSON.stringify({ scope: "renewal_outcome", status: "mismatch", customerOk, amountOk, currencyOk, paidOk }));
    return;
  }
  await recordRenewalOutcome(ctx, {
    billingAccountId: acct.id,
    externalRef,
    serviceEntitlementId,
    status: "paid",
    amountCents: session.amount_total,
    currency: session.currency || md.currency,
    paidAt: new Date(),
    stripeEventId: eventId,
  });
}

async function recordRenewalOutcome(ctx: BillingContext, rec: RenewalOutcomeRecord): Promise<void> {
  const existing = await ctx.db.billingRenewalOutcome.findFirst({ where: { serviceEntitlementId: rec.serviceEntitlementId } });
  if (existing) {
    if (existing.stripeEventId && rec.stripeEventId && existing.stripeEventId === rec.stripeEventId) return;
    if (existing.status === "paid" && rec.status !== "paid") return;
    await ctx.db.billingRenewalOutcome.update({ where: { id: existing.id }, data: rec });
  } else {
    await ctx.db.billingRenewalOutcome.create({ data: rec });
  }
}

function mapStripeFailureToSafeCode(raw: string): string {
  switch (raw) {
    case "card_declined":
    case "do_not_honor":
    case "transaction_not_allowed":
      return "card_declined";
    case "insufficient_funds":
      return "insufficient_funds";
    case "expired_card":
      return "expired_card";
    case "incorrect_cvc":
    case "invalid_cvc":
      return "incorrect_cvc";
    case "authentication_required":
      return "authentication_required";
    case "processing_error":
      return "processing_error";
    case "":
      return "unknown";
    default:
      return "generic_decline";
  }
}
