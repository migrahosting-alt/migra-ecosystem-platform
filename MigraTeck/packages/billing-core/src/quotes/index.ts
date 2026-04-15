import type Stripe from "stripe";
import type { BillingContext } from "../context.js";
import type { BillingQuote } from "../types.js";

export interface CreateQuoteInput {
  orgId: string;
  lineItems: Array<{
    priceLookupKey: string;
    quantity?: number;
  }>;
  header?: string;
  description?: string;
  expiresInDays?: number;
  metadata?: Record<string, string>;
}

/**
 * Create a Stripe Quote for enterprise/sales-assisted flows.
 */
export async function createQuote(
  ctx: BillingContext,
  input: CreateQuoteInput,
): Promise<BillingQuote> {
  const account = await ctx.db.billingAccount.findUnique({
    where: { orgId: input.orgId },
  });
  if (!account?.stripeCustomerId) {
    throw new Error(`No billing account for org ${input.orgId}`);
  }

  // Resolve lookup keys to Stripe price IDs before creating quote
  const lookupKeys = input.lineItems.map((li) => li.priceLookupKey);
  const priceList = await ctx.stripe.prices.list({ lookup_keys: lookupKeys, limit: lookupKeys.length });
  const priceIdMap: Record<string, string> = {};
  for (const price of priceList.data) {
    if (price.lookup_key) priceIdMap[price.lookup_key] = price.id;
  }

  const quoteParams: Stripe.QuoteCreateParams = {
    customer: account.stripeCustomerId,
    line_items: input.lineItems.map((li) => {
      const priceId = priceIdMap[li.priceLookupKey];
      if (!priceId) throw new Error(`Stripe price not found for lookup key: ${li.priceLookupKey}`);
      return { price: priceId, quantity: li.quantity ?? 1 };
    }),
    metadata: {
      org_id: input.orgId,
      platform: "migrateck",
      ...input.metadata,
    },
    ...(input.expiresInDays
      ? { expires_at: Math.floor(Date.now() / 1000) + input.expiresInDays * 86400 }
      : {}),
    ...(input.header ? { header: input.header } : {}),
    ...(input.description ? { description: input.description } : {}),
  };

  const stripeQuote = await ctx.stripe.quotes.create(quoteParams);

  const quote = await ctx.db.billingQuote.create({
    data: {
      orgId: input.orgId,
      billingAccountId: account.id,
      stripeQuoteId: stripeQuote.id,
      status: "DRAFT",
      expiresAt: stripeQuote.expires_at
        ? new Date(stripeQuote.expires_at * 1000)
        : null,
    },
  });

  return quote as BillingQuote;
}

/**
 * List quotes for an org.
 */
export async function getQuotes(
  ctx: BillingContext,
  orgId: string,
): Promise<BillingQuote[]> {
  const quotes = await ctx.db.billingQuote.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
  });
  return quotes as BillingQuote[];
}

/**
 * Get a single quote by ID.
 */
export async function getQuote(
  ctx: BillingContext,
  quoteId: string,
): Promise<BillingQuote | null> {
  const quote = await ctx.db.billingQuote.findUnique({
    where: { id: quoteId },
  });
  return quote as BillingQuote | null;
}

/**
 * Finalize a quote (send to customer).
 */
export async function finalizeQuote(
  ctx: BillingContext,
  quoteId: string,
): Promise<BillingQuote> {
  const quote = await ctx.db.billingQuote.findUnique({
    where: { id: quoteId },
  });
  if (!quote?.stripeQuoteId) {
    throw new Error(`Quote ${quoteId} not found`);
  }

  await ctx.stripe.quotes.finalizeQuote(quote.stripeQuoteId);

  const updated = await ctx.db.billingQuote.update({
    where: { id: quoteId },
    data: { status: "OPEN" },
  });

  return updated as BillingQuote;
}

/**
 * Accept a quote and create the subscription.
 */
export async function acceptQuote(
  ctx: BillingContext,
  quoteId: string,
): Promise<BillingQuote> {
  const quote = await ctx.db.billingQuote.findUnique({
    where: { id: quoteId },
  });
  if (!quote?.stripeQuoteId) {
    throw new Error(`Quote ${quoteId} not found`);
  }

  await ctx.stripe.quotes.accept(quote.stripeQuoteId);

  const updated = await ctx.db.billingQuote.update({
    where: { id: quoteId },
    data: { status: "ACCEPTED", acceptedAt: new Date() },
  });

  return updated as BillingQuote;
}
