import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireOrganizationPrincipal } from "../../../lib/migraauth.js";
import {
  createBillingContext,
  type BillingContext,
} from "@migrateck/billing-core";
import { PRODUCT_CATALOG } from "@migrateck/billing-core/catalog";
import {
  getBillingAccount,
  updateBillingAccount,
} from "@migrateck/billing-core/customers";
import { getPaymentMethods } from "@migrateck/billing-core/customers/payment-methods";
import { createCheckoutSession } from "@migrateck/billing-core/checkout";
import {
  getSubscriptions,
  getSubscription,
  changePlan,
  changeSeats,
  pauseSubscription,
  resumeSubscription,
  cancelSubscription,
} from "@migrateck/billing-core/subscriptions";
import { getOrgEntitlements } from "@migrateck/billing-core/entitlements";
import {
  constructEvent,
  processWebhookEvent,
} from "@migrateck/billing-core/webhooks";
import { getInvoices, getInvoice } from "@migrateck/billing-core/invoices";
import {
  recordUsage,
  getUsageSummary,
} from "@migrateck/billing-core/usage";
import { createPortalSession } from "@migrateck/billing-core/portal";
import {
  createQuote,
  getQuotes,
  getQuote,
  finalizeQuote,
  acceptQuote,
} from "@migrateck/billing-core/quotes";
import { getDunningState } from "@migrateck/billing-core/dunning";
import { getTaxInfo, updateTaxInfo } from "@migrateck/billing-core/tax";
import {
  updateBillingAccountSchema,
  createCheckoutSessionSchema,
  changePlanSchema,
  changeSeatsSchema,
  recordUsageSchema,
  usageSummaryQuerySchema,
  createQuoteSchema,
  createPortalSessionSchema,
} from "@migrateck/billing-core/schemas";

// ─── Context ────────────────────────────────────────────────────────

let _billingCtx: BillingContext | null = null;

function getBillingCtx(): BillingContext {
  if (!_billingCtx) {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      throw Object.assign(new Error("Billing processor is not configured"), {
        statusCode: 503,
      });
    }

    const billingDb = (globalThis as any).__billingDb;
    if (!billingDb) {
      throw Object.assign(
        new Error("Billing runtime database adapter is not initialized"),
        { statusCode: 503 },
      );
    }

    _billingCtx = createBillingContext({
      stripeSecretKey: stripeKey,
      db: billingDb,
    });
  }
  return _billingCtx;
}

// ─── Helpers ────────────────────────────────────────────────────────

async function requireBillingOrganization(request: FastifyRequest) {
  return requireOrganizationPrincipal(request, ["OWNER", "ADMIN"]);
}

function assertOrgOwnedResource(
  resource: unknown,
  orgId: string,
  resourceName: string,
): asserts resource is { orgId: string } {
  if (
    !resource ||
    typeof resource !== "object" ||
    (resource as { orgId?: string }).orgId !== orgId
  ) {
    throw Object.assign(new Error(resourceName + " not found"), {
      statusCode: 404,
    });
  }
}

// ─── Routes ─────────────────────────────────────────────────────────

export async function registerBillingRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ── Catalog (public, no auth) ──────────────────────────────────

  app.get("/billing/catalog", async () => ({
    products: PRODUCT_CATALOG,
  }));

  app.get<{ Params: { family: string } }>(
    "/billing/catalog/:family",
    async (request) => {
      const product = PRODUCT_CATALOG.find(
        (p) => p.productFamily === request.params.family,
      );
      if (!product)
        throw Object.assign(
          new Error(`Unknown product family: ${request.params.family}`),
          { statusCode: 404 },
        );
      return product;
    },
  );

  // ── Billing Account ────────────────────────────────────────────

  app.get("/billing/account", async (request) => {
    const { platformOrgId: orgId } = await requireBillingOrganization(request);
    const ctx = getBillingCtx();
    const account = await getBillingAccount(ctx, orgId);
    if (!account)
      throw Object.assign(new Error("Billing account not found"), {
        statusCode: 404,
      });
    return account;
  });

  app.put("/billing/account", async (request) => {
    const { platformOrgId: orgId } = await requireBillingOrganization(request);
    const ctx = getBillingCtx();
    const body = updateBillingAccountSchema.parse(request.body);
    return updateBillingAccount(ctx, orgId, body);
  });

  // ── Payment Methods ────────────────────────────────────────────

  app.get("/billing/payment-methods", async (request) => {
    const { platformOrgId: orgId } = await requireBillingOrganization(request);
    const ctx = getBillingCtx();
    return getPaymentMethods(ctx, orgId);
  });

  // ── Portal Session ─────────────────────────────────────────────

  app.post("/billing/portal-session", async (request) => {
    const { platformOrgId: orgId } = await requireBillingOrganization(request);
    const ctx = getBillingCtx();
    const body = createPortalSessionSchema.parse(request.body);
    return createPortalSession(ctx, orgId, body.returnUrl);
  });

  // ── Checkout Session ───────────────────────────────────────────

  app.post("/billing/checkout/session", async (request) => {
    const principal = await requireBillingOrganization(request);
    const orgId = principal.platformOrgId;
    const ctx = getBillingCtx();
    const body = createCheckoutSessionSchema.parse(request.body);

    const orgName = principal.membership.name;
    const billingEmail = principal.authUser.email;
    if (!billingEmail) {
      throw Object.assign(
        new Error("The authenticated account does not have a billing email"),
        { statusCode: 400 },
      );
    }

    return createCheckoutSession(ctx, {
      orgId,
      orgName,
      billingEmail,
      productFamily: body.productFamily,
      planCode: body.planCode,
      billingInterval: body.billingInterval,
      ...(body.seatCount !== undefined ? { seatCount: body.seatCount } : {}),
      successUrl: body.successUrl,
      cancelUrl: body.cancelUrl,
      ...(body.trialDays !== undefined ? { trialDays: body.trialDays } : {}),
    });
  });

  // ── Subscriptions ──────────────────────────────────────────────

  app.get("/billing/subscriptions", async (request) => {
    const { platformOrgId: orgId } = await requireBillingOrganization(request);
    const ctx = getBillingCtx();
    return getSubscriptions(ctx, orgId);
  });

  app.get<{ Params: { subscriptionId: string } }>(
    "/billing/subscriptions/:subscriptionId",
    async (request) => {
      const { platformOrgId: orgId } = await requireBillingOrganization(request);
      const ctx = getBillingCtx();
      const sub = await getSubscription(ctx, request.params.subscriptionId);
      assertOrgOwnedResource(sub, orgId, "Subscription");
      return sub;
    },
  );

  app.post<{ Params: { subscriptionId: string } }>(
    "/billing/subscriptions/:subscriptionId/change-plan",
    async (request) => {
      const { platformOrgId: orgId } = await requireBillingOrganization(request);
      const ctx = getBillingCtx();
      const subscription = await getSubscription(ctx, request.params.subscriptionId);
      assertOrgOwnedResource(subscription, orgId, "Subscription");
      const body = changePlanSchema.parse(request.body);
      return changePlan(ctx, {
        subscriptionId: request.params.subscriptionId,
        newPlanCode: body.newPlanCode,
        newBillingInterval: body.newBillingInterval,
        idempotencyKey: `change-plan-${request.params.subscriptionId}-${Date.now()}`,
      });
    },
  );

  app.post<{ Params: { subscriptionId: string } }>(
    "/billing/subscriptions/:subscriptionId/change-seats",
    async (request) => {
      const { platformOrgId: orgId } = await requireBillingOrganization(request);
      const ctx = getBillingCtx();
      const subscription = await getSubscription(ctx, request.params.subscriptionId);
      assertOrgOwnedResource(subscription, orgId, "Subscription");
      const body = changeSeatsSchema.parse(request.body);
      return changeSeats(ctx, {
        subscriptionId: request.params.subscriptionId,
        newSeatCount: body.newSeatCount,
        idempotencyKey: `change-seats-${request.params.subscriptionId}-${Date.now()}`,
      });
    },
  );

  app.post<{ Params: { subscriptionId: string } }>(
    "/billing/subscriptions/:subscriptionId/pause",
    async (request) => {
      const { platformOrgId: orgId } = await requireBillingOrganization(request);
      const ctx = getBillingCtx();
      const subscription = await getSubscription(ctx, request.params.subscriptionId);
      assertOrgOwnedResource(subscription, orgId, "Subscription");
      return pauseSubscription(
        ctx,
        request.params.subscriptionId,
        `pause-${request.params.subscriptionId}-${Date.now()}`,
      );
    },
  );

  app.post<{ Params: { subscriptionId: string } }>(
    "/billing/subscriptions/:subscriptionId/resume",
    async (request) => {
      const { platformOrgId: orgId } = await requireBillingOrganization(request);
      const ctx = getBillingCtx();
      const subscription = await getSubscription(ctx, request.params.subscriptionId);
      assertOrgOwnedResource(subscription, orgId, "Subscription");
      return resumeSubscription(
        ctx,
        request.params.subscriptionId,
        `resume-${request.params.subscriptionId}-${Date.now()}`,
      );
    },
  );

  app.post<{ Params: { subscriptionId: string } }>(
    "/billing/subscriptions/:subscriptionId/cancel",
    async (request) => {
      const { platformOrgId: orgId } = await requireBillingOrganization(request);
      const ctx = getBillingCtx();
      const subscription = await getSubscription(ctx, request.params.subscriptionId);
      assertOrgOwnedResource(subscription, orgId, "Subscription");
      const body = z
        .object({ immediate: z.boolean().optional() })
        .parse(request.body);
      return cancelSubscription(ctx, {
        subscriptionId: request.params.subscriptionId,
        cancelImmediately: body.immediate,
        idempotencyKey: `cancel-${request.params.subscriptionId}-${Date.now()}`,
      });
    },
  );

  // ── Entitlements ───────────────────────────────────────────────

  app.get("/billing/entitlements", async (request) => {
    const { platformOrgId: orgId } = await requireBillingOrganization(request);
    const ctx = getBillingCtx();
    return getOrgEntitlements(ctx, orgId);
  });

  // ── Dunning ────────────────────────────────────────────────────

  app.get("/billing/dunning", async (request) => {
    const { platformOrgId: orgId } = await requireBillingOrganization(request);
    const ctx = getBillingCtx();
    const state = await getDunningState(ctx, orgId);
    return { orgId, dunningState: state };
  });

  // ── Invoices ───────────────────────────────────────────────────

  app.get("/billing/invoices", async (request) => {
    const { platformOrgId: orgId } = await requireBillingOrganization(request);
    const ctx = getBillingCtx();
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).optional(),
        offset: z.coerce.number().int().min(0).optional(),
      })
      .parse(request.query);
    return getInvoices(ctx, orgId, query);
  });

  app.get<{ Params: { invoiceId: string } }>(
    "/billing/invoices/:invoiceId",
    async (request) => {
      const { platformOrgId: orgId } = await requireBillingOrganization(request);
      const ctx = getBillingCtx();
      const invoice = await getInvoice(ctx, request.params.invoiceId);
      assertOrgOwnedResource(invoice, orgId, "Invoice");
      return invoice;
    },
  );

  // ── Usage ──────────────────────────────────────────────────────

  app.post("/billing/usage", async (request) => {
    const { platformOrgId: orgId } = await requireBillingOrganization(request);
    const ctx = getBillingCtx();
    const body = recordUsageSchema.parse(request.body);
    return recordUsage(ctx, {
      orgId,
      productFamily: body.productFamily,
      meterName: body.meterName,
      quantity: body.quantity,
      windowStart: new Date(body.windowStart),
      windowEnd: new Date(body.windowEnd),
      idempotencyKey: body.idempotencyKey,
      source: body.source ?? "api",
    });
  });

  app.get("/billing/usage/summary", async (request) => {
    const { platformOrgId: orgId } = await requireBillingOrganization(request);
    const ctx = getBillingCtx();
    const query = usageSummaryQuerySchema.parse(request.query);
    return getUsageSummary(ctx, orgId, {
      productFamily: query.productFamily,
      meterName: query.meterName,
      since: query.since ? new Date(query.since) : undefined,
    });
  });

  // ── Tax ────────────────────────────────────────────────────────

  app.get("/billing/tax", async (request) => {
    const { platformOrgId: orgId } = await requireBillingOrganization(request);
    const ctx = getBillingCtx();
    return getTaxInfo(ctx, orgId);
  });

  app.put("/billing/tax", async (request) => {
    const { platformOrgId: orgId } = await requireBillingOrganization(request);
    const ctx = getBillingCtx();
    const body = z
      .object({
        taxCountry: z.string().length(2),
        // `.nullable()` so a caller can CLEAR a field, `.optional()` so omitting one leaves
        // it untouched. The two are different requests and must not be conflated — see
        // UpdateTaxInfoInput.
        taxState: z.string().max(80).nullable().optional(),
        taxId: z.string().max(80).nullable().optional(),
      })
      .parse(request.body);
    await updateTaxInfo(ctx, orgId, body);
    return { ok: true };
  });

  // ── Quotes ─────────────────────────────────────────────────────

  app.get("/billing/quotes", async (request) => {
    const { platformOrgId: orgId } = await requireBillingOrganization(request);
    const ctx = getBillingCtx();
    return getQuotes(ctx, orgId);
  });

  app.get<{ Params: { quoteId: string } }>(
    "/billing/quotes/:quoteId",
    async (request) => {
      const { platformOrgId: orgId } = await requireBillingOrganization(request);
      const ctx = getBillingCtx();
      const quote = await getQuote(ctx, request.params.quoteId);
      assertOrgOwnedResource(quote, orgId, "Quote");
      return quote;
    },
  );

  app.post("/billing/quotes", async (request) => {
    const { platformOrgId: orgId } = await requireBillingOrganization(request);
    const ctx = getBillingCtx();
    const body = createQuoteSchema.parse(request.body);
    return createQuote(ctx, { orgId, ...body });
  });

  app.post<{ Params: { quoteId: string } }>(
    "/billing/quotes/:quoteId/finalize",
    async (request) => {
      const { platformOrgId: orgId } = await requireBillingOrganization(request);
      const ctx = getBillingCtx();
      const quote = await getQuote(ctx, request.params.quoteId);
      assertOrgOwnedResource(quote, orgId, "Quote");
      return finalizeQuote(ctx, request.params.quoteId);
    },
  );

  app.post<{ Params: { quoteId: string } }>(
    "/billing/quotes/:quoteId/accept",
    async (request) => {
      const { platformOrgId: orgId } = await requireBillingOrganization(request);
      const ctx = getBillingCtx();
      const quote = await getQuote(ctx, request.params.quoteId);
      assertOrgOwnedResource(quote, orgId, "Quote");
      return acceptQuote(ctx, request.params.quoteId);
    },
  );

  // ── Stripe Webhook ─────────────────────────────────────────────

  app.post(
    "/billing/webhooks/stripe",
    {
      config: {
        rawBody: true,
      },
    },
    async (request, reply) => {
      const ctx = getBillingCtx();
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!webhookSecret)
        throw new Error("STRIPE_WEBHOOK_SECRET is not configured");

      const signature = request.headers["stripe-signature"];
      if (!signature)
        throw Object.assign(new Error("Missing stripe-signature header"), {
          statusCode: 400,
        });

      const rawBody =
        (request as any).rawBody ?? (request.body as string | Buffer);
      const event = constructEvent(
        ctx,
        rawBody,
        signature as string,
        webhookSecret,
      );
      const result = await processWebhookEvent(ctx, event);

      reply.code(200).send({ received: true, status: result.status });
    },
  );
}
