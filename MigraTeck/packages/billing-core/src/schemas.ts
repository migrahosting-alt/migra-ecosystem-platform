import { z } from "zod";

// ─── Common ──────────────────────────────────────────────────────────

export const productFamilySchema = z.enum([
  "builder", "hosting", "intake", "invoice",
  "voice", "email", "marketing", "pilot", "drive",
]);

export const planCodeSchema = z.enum([
  "free", "starter", "pro", "business", "enterprise",
]);

export const billingIntervalSchema = z.enum(["month", "year"]);

// ─── Billing Account ────────────────────────────────────────────────

export const updateBillingAccountSchema = z.object({
  billingEmail: z.string().email().optional(),
  billingContactName: z.string().max(255).optional(),
  taxCountry: z.string().length(2).optional(),
  taxState: z.string().max(80).optional(),
  taxId: z.string().max(80).optional(),
});

// ─── Checkout ────────────────────────────────────────────────────────

export const createCheckoutSessionSchema = z.object({
  productFamily: productFamilySchema,
  planCode: planCodeSchema,
  billingInterval: billingIntervalSchema,
  seatCount: z.number().int().min(1).optional(),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
  trialDays: z.number().int().min(1).max(90).optional(),
});

// ─── Subscriptions ──────────────────────────────────────────────────

export const createSubscriptionSchema = z.object({
  productFamily: productFamilySchema,
  planCode: planCodeSchema,
  billingInterval: billingIntervalSchema,
  seatCount: z.number().int().min(1).optional(),
  trialDays: z.number().int().min(1).max(90).optional(),
});

export const changePlanSchema = z.object({
  newPlanCode: planCodeSchema,
  newBillingInterval: billingIntervalSchema.optional(),
});

export const changeSeatsSchema = z.object({
  newSeatCount: z.number().int().min(1).max(10000),
});

// ─── Usage ──────────────────────────────────────────────────────────

export const recordUsageSchema = z.object({
  productFamily: productFamilySchema,
  meterName: z.string().min(1).max(80),
  quantity: z.number().int().min(1),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
  idempotencyKey: z.string().min(1).max(255),
  source: z.enum(["api", "worker", "system", "manual"]).optional(),
});

export const usageSummaryQuerySchema = z.object({
  productFamily: productFamilySchema.optional(),
  meterName: z.string().optional(),
  since: z.string().datetime().optional(),
});

// ─── Quotes ─────────────────────────────────────────────────────────

export const createQuoteSchema = z.object({
  lineItems: z.array(z.object({
    priceLookupKey: z.string().min(1),
    quantity: z.number().int().min(1).optional(),
  })).min(1),
  header: z.string().max(500).optional(),
  description: z.string().max(2000).optional(),
  expiresInDays: z.number().int().min(1).max(90).optional(),
});

// ─── Support / Admin ────────────────────────────────────────────────

export const issueCreditsSchema = z.object({
  kind: z.enum(["credit", "service_credit", "goodwill", "refund", "promo"]),
  amount: z.number().int().min(1),
  currency: z.string().length(3).optional(),
  reason: z.string().min(1).max(500),
  stripeInvoiceId: z.string().optional(),
});

export const overrideEntitlementsSchema = z.object({
  entitlements: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  reason: z.string().min(1).max(500),
  expiresAt: z.string().datetime().optional(),
});

// ─── Portal ─────────────────────────────────────────────────────────

export const createPortalSessionSchema = z.object({
  returnUrl: z.string().url(),
});
