import type Stripe from "stripe";
import type { BillingContext } from "../context";
import type { BillingInvoice, InvoiceStatus } from "../types";

function mapStripeInvoiceStatus(status: string | null): InvoiceStatus {
  const map: Record<string, InvoiceStatus> = {
    draft: "draft",
    open: "open",
    paid: "paid",
    void: "void",
    uncollectible: "uncollectible",
  };
  return map[status ?? "draft"] ?? "draft";
}

/**
 * Sync an invoice from a Stripe Invoice object (webhook-driven).
 */
export async function syncInvoiceFromStripe(
  ctx: BillingContext,
  stripeInvoice: Stripe.Invoice,
): Promise<BillingInvoice> {
  const customerId = typeof stripeInvoice.customer === "string"
    ? stripeInvoice.customer
    : stripeInvoice.customer?.id ?? null;

  const account = customerId
    ? await ctx.db.billingAccount.findUnique({ where: { stripeCustomerId: customerId } })
    : null;

  if (!account) {
    throw new Error(`No billing account for Stripe customer ${customerId}`);
  }

  const status = mapStripeInvoiceStatus(stripeInvoice.status).toUpperCase();
  const subscriptionRef = stripeInvoice.subscription;
  const subscriptionId = typeof subscriptionRef === "string"
    ? subscriptionRef
    : (subscriptionRef?.id ?? null);

  const invoice = await ctx.db.billingInvoice.upsert({
    where: { stripeInvoiceId: stripeInvoice.id },
    create: {
      orgId: account.orgId,
      billingAccountId: account.id,
      stripeInvoiceId: stripeInvoice.id,
      stripeSubscriptionId: subscriptionId,
      status,
      currency: stripeInvoice.currency ?? "usd",
      subtotal: stripeInvoice.subtotal ?? 0,
      tax: (stripeInvoice.total_tax_amounts ?? []).reduce((sum: number, t: { amount: number }) => sum + t.amount, 0),
      total: stripeInvoice.total ?? 0,
      amountPaid: stripeInvoice.amount_paid ?? 0,
      amountRemaining: stripeInvoice.amount_remaining ?? 0,
      hostedInvoiceUrl: stripeInvoice.hosted_invoice_url ?? null,
      invoicePdf: stripeInvoice.invoice_pdf ?? null,
      issuedAt: stripeInvoice.status_transitions?.finalized_at
        ? new Date(stripeInvoice.status_transitions.finalized_at * 1000)
        : null,
      paidAt: stripeInvoice.status_transitions?.paid_at
        ? new Date(stripeInvoice.status_transitions.paid_at * 1000)
        : null,
    },
    update: {
      status,
      subtotal: stripeInvoice.subtotal ?? 0,
      tax: (stripeInvoice.total_tax_amounts ?? []).reduce((sum: number, t: { amount: number }) => sum + t.amount, 0),
      total: stripeInvoice.total ?? 0,
      amountPaid: stripeInvoice.amount_paid ?? 0,
      amountRemaining: stripeInvoice.amount_remaining ?? 0,
      hostedInvoiceUrl: stripeInvoice.hosted_invoice_url ?? null,
      invoicePdf: stripeInvoice.invoice_pdf ?? null,
      issuedAt: stripeInvoice.status_transitions?.finalized_at
        ? new Date(stripeInvoice.status_transitions.finalized_at * 1000)
        : null,
      paidAt: stripeInvoice.status_transitions?.paid_at
        ? new Date(stripeInvoice.status_transitions.paid_at * 1000)
        : null,
    },
  });

  return invoice as BillingInvoice;
}

/**
 * List invoices for an org.
 */
export async function getInvoices(
  ctx: BillingContext,
  orgId: string,
  opts?: { limit?: number; offset?: number },
): Promise<BillingInvoice[]> {
  const invoices = await ctx.db.billingInvoice.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    take: opts?.limit ?? 50,
    skip: opts?.offset ?? 0,
  });
  return invoices as BillingInvoice[];
}

/**
 * Get a single invoice by ID.
 */
export async function getInvoice(
  ctx: BillingContext,
  invoiceId: string,
): Promise<BillingInvoice | null> {
  const invoice = await ctx.db.billingInvoice.findUnique({
    where: { id: invoiceId },
  });
  return invoice as BillingInvoice | null;
}
