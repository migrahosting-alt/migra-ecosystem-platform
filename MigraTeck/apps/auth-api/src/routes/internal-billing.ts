import type { FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { db } from "../lib/db.js";
import { config } from "../config/env.js";
import { createBillingContext } from "@migrateck/billing-core";

// Service-token-only guard (no browser/user-session auth for this route).
function authorizedService(token: string | undefined): boolean {
  const expected = process.env["MIGRAPAY_INTERNAL_SERVICE_TOKEN"] || "";
  if (!expected || !token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function internalBillingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/internal/billing/payment-methods", async (request, reply) => {
    const token = request.headers["x-migrapay-internal-token"] as string | undefined;
    if (!token) return reply.code(401).send({ ok: false, error: "unauthorized_service" });
    if (!authorizedService(token)) return reply.code(403).send({ ok: false, error: "forbidden" });

    const q = request.query as { externalRef?: string; orgId?: string };
    const externalRef = (q.externalRef ?? "").trim();
    const orgId = (q.orgId ?? "").trim();
    if (!externalRef && !orgId) {
      return reply.code(400).send({ ok: false, error: "missing_account_selector" });
    }

    try {
      const acct = await db.billingAccount.findFirst({
        where: externalRef ? { externalRef } : { orgId },
        select: { orgId: true, stripeCustomerId: true },
      });
      if (!acct) {
        request.log.info(
          { scope: "internal_pm", selector: externalRef ? "externalRef" : "orgId", status: 404 },
          "billing account not found",
        );
        return reply.code(404).send({ ok: false, error: "billing_account_not_found" });
      }
      const rows = await db.billingPaymentMethod.findMany({
        where: { orgId: acct.orgId },
        orderBy: { createdAt: "desc" },
        select: { id: true, stripePaymentMethodId: true, brand: true, last4: true, expMonth: true, expYear: true, isDefault: true },
      });
      // Reflect Stripe's LIVE default so the badge never drifts from the hosted portal
      // (the local is_default flag can go stale when the customer switches default in Stripe).
      let stripeDefaultPm: string | null = null;
      if (acct.stripeCustomerId && config.billing.stripeSecretKey) {
        try {
          const ctx = createBillingContext({ stripeSecretKey: config.billing.stripeSecretKey, db: db as any });
          const customer: any = await ctx.stripe.customers.retrieve(acct.stripeCustomerId);
          const dpm = customer && customer.invoice_settings ? customer.invoice_settings.default_payment_method : null;
          stripeDefaultPm = typeof dpm === "string" ? dpm : (dpm && dpm.id) || null;
        } catch { stripeDefaultPm = null; }
      }
      return reply.code(200).send({
        ok: true,
        managedBy: "migrapay",
        methods: rows.map((m) => ({
          id: m.id,
          brand: m.brand ?? null,
          last4: m.last4 ?? null,
          expiryMonth: m.expMonth ?? null,
          expiryYear: m.expYear ?? null,
          isDefault: stripeDefaultPm ? m.stripePaymentMethodId === stripeDefaultPm : (m.isDefault ?? false),
        })),
      });
    } catch (err) {
      const e = err as { code?: string };
      request.log.warn({ scope: "internal_pm", code: e?.code, status: 503 }, "billing read failed");
      return reply.code(503).send({ ok: false, error: "billing_unavailable" });
    }
  });

  app.post("/v1/internal/billing/portal", async (request, reply) => {
    const token = request.headers["x-migrapay-internal-token"] as string | undefined;
    if (!token) return reply.code(401).send({ ok: false, error: "unauthorized_service" });
    if (!authorizedService(token)) return reply.code(403).send({ ok: false, error: "forbidden" });

    const body = (request.body ?? {}) as { externalRef?: string; orgId?: string; returnUrl?: string };
    const externalRef = (body.externalRef ?? "").trim();
    const orgId = (body.orgId ?? "").trim();
    if (!externalRef && !orgId) {
      return reply.code(400).send({ ok: false, error: "missing_account_selector" });
    }
    if (!config.billing.stripeSecretKey) {
      return reply.code(503).send({ ok: false, error: "portal_unavailable" });
    }

    try {
      const acct = await db.billingAccount.findFirst({
        where: externalRef ? { externalRef } : { orgId },
        select: { stripeCustomerId: true },
      });
      if (!acct) {
        request.log.info({ scope: "internal_portal", selector: externalRef ? "externalRef" : "orgId", status: 404 }, "billing account not found");
        return reply.code(404).send({ ok: false, error: "billing_account_not_found" });
      }
      if (!acct.stripeCustomerId) {
        return reply.code(409).send({ ok: false, error: "no_stripe_customer" });
      }

      const returnUrl = typeof body.returnUrl === "string" && body.returnUrl.length > 0 ? body.returnUrl : undefined;
      if (!returnUrl) {
        return reply.code(400).send({ ok: false, error: "missing_return_url" });
      }

      const ctx = createBillingContext({ stripeSecretKey: config.billing.stripeSecretKey, db: db as any });
      const session = await ctx.stripe.billingPortal.sessions.create({
        customer: acct.stripeCustomerId,
        return_url: returnUrl,
      });
      return reply.code(200).send({ ok: true, url: session.url });
    } catch (err) {
      const e = err as { code?: string; type?: string };
      request.log.warn({ scope: "internal_portal", code: e?.code, type: e?.type, status: 503 }, "portal session create failed");
      if (e?.type === "StripeInvalidRequestError") {
        return reply.code(503).send({ ok: false, error: "portal_not_configured" });
      }
      return reply.code(503).send({ ok: false, error: "portal_unavailable" });
    }
  });

  app.post("/v1/internal/billing/renewal-checkout", async (request, reply) => {
    const token = request.headers["x-migrapay-internal-token"] as string | undefined;
    if (!token) return reply.code(401).send({ ok: false, error: "unauthorized_service" });
    if (!authorizedService(token)) return reply.code(403).send({ ok: false, error: "forbidden" });

    const body = (request.body ?? {}) as {
      externalRef?: string; orgId?: string;
      amount?: number; currency?: string; description?: string;
      returnUrl?: string; cancelUrl?: string; idempotencyKey?: string;
      serviceEntitlementId?: string;
    };
    const externalRef = (body.externalRef ?? "").trim();
    const orgId = (body.orgId ?? "").trim();
    if (!externalRef && !orgId) return reply.code(400).send({ ok: false, error: "missing_account_selector" });

    // Amount/currency are server-derived by the panel (never from the browser). Bound-check, don't blind-trust.
    const amount = Number(body.amount);
    const currency = String(body.currency || "").toLowerCase();
    const ALLOWED_CURRENCIES = new Set(["usd"]);
    if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000) {
      return reply.code(400).send({ ok: false, error: "invalid_amount" });
    }
    if (!ALLOWED_CURRENCIES.has(currency)) return reply.code(400).send({ ok: false, error: "invalid_currency" });
    const returnUrl = typeof body.returnUrl === "string" && body.returnUrl ? body.returnUrl : "";
    const cancelUrl = typeof body.cancelUrl === "string" && body.cancelUrl ? body.cancelUrl : "";
    if (!returnUrl || !cancelUrl) return reply.code(400).send({ ok: false, error: "missing_urls" });
    const description = (typeof body.description === "string" && body.description ? body.description : "Service renewal").slice(0, 200);
    if (!config.billing.stripeSecretKey) return reply.code(503).send({ ok: false, error: "renewal_unavailable" });

    try {
      const acct = await db.billingAccount.findFirst({
        where: externalRef ? { externalRef } : { orgId },
        select: { stripeCustomerId: true },
      });
      if (!acct) {
        request.log.info({ scope: "internal_renewal", selector: externalRef ? "externalRef" : "orgId", status: 404 }, "billing account not found");
        return reply.code(404).send({ ok: false, error: "billing_account_not_found" });
      }
      if (!acct.stripeCustomerId) return reply.code(409).send({ ok: false, error: "no_stripe_customer" });

      const ctx = createBillingContext({ stripeSecretKey: config.billing.stripeSecretKey, db: db as any });
      const session = await ctx.stripe.checkout.sessions.create(
        {
          mode: "payment",
          customer: acct.stripeCustomerId,
          line_items: [{ quantity: 1, price_data: { currency, unit_amount: amount, product_data: { name: description } } }],
          success_url: returnUrl,
          cancel_url: cancelUrl,
          metadata: {
            kind: "renewal",
            externalRef,
            serviceEntitlementId: typeof body.serviceEntitlementId === "string" ? body.serviceEntitlementId : "",
            amount_cents: String(amount),
            currency,
            description,
          },
          payment_intent_data: {
            metadata: {
              kind: "renewal",
              externalRef,
              serviceEntitlementId: typeof body.serviceEntitlementId === "string" ? body.serviceEntitlementId : "",
              amount_cents: String(amount),
              currency,
            },
          },
        },
        body.idempotencyKey ? { idempotencyKey: String(body.idempotencyKey).slice(0, 200) } : undefined,
      );
      return reply.code(200).send({ ok: true, url: session.url });
    } catch (err) {
      const e = err as { code?: string; type?: string };
      request.log.warn({ scope: "internal_renewal", code: e?.code, type: e?.type, status: 503 }, "renewal checkout create failed");
      if (e?.type === "StripeInvalidRequestError") return reply.code(503).send({ ok: false, error: "renewal_config_error" });
      return reply.code(503).send({ ok: false, error: "renewal_unavailable" });
    }
  });

  app.get("/v1/internal/billing/renewal-status", async (request, reply) => {
    const token = request.headers["x-migrapay-internal-token"] as string | undefined;
    if (!token) return reply.code(401).send({ ok: false, error: "unauthorized_service" });
    if (!authorizedService(token)) return reply.code(403).send({ ok: false, error: "forbidden" });

    const q = (request.query ?? {}) as { externalRef?: string; serviceEntitlementId?: string };
    const externalRef = (q.externalRef ?? "").trim();
    const serviceEntitlementId = (q.serviceEntitlementId ?? "").trim();
    if (!externalRef || !serviceEntitlementId) return reply.code(400).send({ ok: false, error: "missing_params" });

    try {
      const acct = await db.billingAccount.findFirst({ where: { externalRef }, select: { id: true } });
      if (!acct) return reply.code(404).send({ ok: false, error: "not_found" });

      const row = await db.billingRenewalOutcome.findFirst({
        where: { billingAccountId: acct.id, serviceEntitlementId },
        orderBy: { updatedAt: "desc" },
        select: { status: true, failureCode: true, failureMessageCode: true, amountCents: true, currency: true, paidAt: true, updatedAt: true },
      });
      if (!row) return reply.code(200).send({ ok: true, status: "pending" });

      return reply.code(200).send({
        ok: true,
        status: row.status,
        failureCode: row.failureCode ?? undefined,
        failureMessageCode: row.failureMessageCode ?? undefined,
        amountCents: row.amountCents ?? undefined,
        currency: row.currency ?? undefined,
        paidAt: row.paidAt ? row.paidAt.toISOString() : undefined,
        updatedAt: row.updatedAt ? row.updatedAt.toISOString() : undefined,
      });
    } catch (err) {
      const e = err as { code?: string; type?: string };
      request.log.warn({ scope: "internal_renewal_status", code: e?.code, type: e?.type }, "renewal status lookup failed");
      return reply.code(200).send({ ok: true, status: "unknown" });
    }
  });
  // Off-session autopay renewal charge (canonical: MigraPay owns Stripe + paid-truth).
  app.post("/v1/internal/billing/renewal-charge", async (request, reply) => {
    const token = request.headers["x-migrapay-internal-token"] as string | undefined;
    if (!token) return reply.code(401).send({ ok: false, error: "unauthorized_service" });
    if (!authorizedService(token)) return reply.code(403).send({ ok: false, error: "forbidden" });
    const body = (request.body ?? {}) as { externalRef?: string; serviceEntitlementId?: string; amountCents?: number; amount?: number; currency?: string; description?: string; idempotencyKey?: string };
    const externalRef = (body.externalRef ?? "").trim();
    const serviceEntitlementId = (body.serviceEntitlementId ?? "").trim();
    const amount = Number(body.amountCents ?? body.amount);
    const currency = String(body.currency || "").toLowerCase();
    const description = (typeof body.description === "string" && body.description ? body.description : "Service renewal").slice(0, 200);
    if (!externalRef || !serviceEntitlementId) return reply.code(400).send({ ok: false, error: "missing_params" });
    if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000) return reply.code(400).send({ ok: false, error: "invalid_amount" });
    if (currency !== "usd") return reply.code(400).send({ ok: false, error: "invalid_currency" });
    if (!config.billing.stripeSecretKey) return reply.code(503).send({ ok: false, error: "charge_unavailable" });
    const SAFE_FAILURE_CODES = ["insufficient_funds", "card_declined", "authentication_required", "expired_card", "incorrect_cvc", "processing_error", "generic_decline", "payment_failed"];
    const mapSafeFailureCode = (raw: string): string => {
      const r = String(raw || "").toLowerCase();
      if (SAFE_FAILURE_CODES.includes(r)) return r;
      switch (r) {
        case "do_not_honor": case "transaction_not_allowed": case "card_not_supported": case "currency_not_supported": case "card_velocity_exceeded": case "service_not_allowed": case "stolen_card": case "lost_card": case "pickup_card": return "card_declined";
        case "invalid_cvc": return "incorrect_cvc";
        case "invalid_expiry_year": case "invalid_expiry_month": return "expired_card";
        case "try_again_later": case "issuer_not_available": case "reenter_transaction": return "processing_error";
        case "": return "payment_failed";
        default: return "generic_decline";
      }
    };
    try {
      const acct = await db.billingAccount.findFirst({ where: { externalRef }, select: { id: true, stripeCustomerId: true } });
      if (!acct) return reply.code(404).send({ ok: false, error: "billing_account_not_found" });
      if (!acct.stripeCustomerId) return reply.code(409).send({ ok: false, error: "no_stripe_customer" });
      const ctx = createBillingContext({ stripeSecretKey: config.billing.stripeSecretKey, db: db as any });
      const customer: any = await ctx.stripe.customers.retrieve(acct.stripeCustomerId);
      const dpm = customer && customer.invoice_settings ? customer.invoice_settings.default_payment_method : null;
      const paymentMethodId = typeof dpm === "string" ? dpm : (dpm && dpm.id) || null;
      if (!paymentMethodId) return reply.code(409).send({ ok: false, error: "no_default_payment_method" });
      const idempotencyKey = (typeof body.idempotencyKey === "string" && body.idempotencyKey) ? String(body.idempotencyKey).slice(0, 200) : `renewal-charge:${externalRef}:${serviceEntitlementId}`;
      const meta = { kind: "renewal", externalRef, serviceEntitlementId, amount_cents: String(amount), currency, description };
      let pi: any;
      try {
        pi = await ctx.stripe.paymentIntents.create({ amount, currency, customer: acct.stripeCustomerId, payment_method: paymentMethodId, off_session: true, confirm: true, description, metadata: meta }, { idempotencyKey });
      } catch (e: any) {
        const declineCode = String((e && (e.decline_code || (e.raw && e.raw.decline_code) || (e.payment_intent && e.payment_intent.last_payment_error && e.payment_intent.last_payment_error.decline_code))) || "");
        const errCode = String((e && (e.code || (e.raw && e.raw.code))) || "");
        const failureCode = mapSafeFailureCode(declineCode || errCode || "payment_failed");
        if (failureCode === "authentication_required") { request.log.warn({ scope: "renewal_charge", outcome: "requires_action" }, "renewal off-session requires authentication"); return reply.code(200).send({ ok: true, status: "requires_action" }); }
        await db.billingRenewalOutcome.upsert({ where: { serviceEntitlementId }, create: { billingAccountId: acct.id, externalRef, serviceEntitlementId, status: "failed", failureCode, failureMessageCode: failureCode, amountCents: amount, currency }, update: { status: "failed", failureCode, failureMessageCode: failureCode, amountCents: amount, currency } });
        request.log.warn({ scope: "renewal_charge", outcome: "failed", failureCode }, "renewal off-session charge failed");
        return reply.code(200).send({ ok: false, status: "failed", failureCode });
      }
      if (pi.status === "succeeded") {
        await db.billingRenewalOutcome.upsert({ where: { serviceEntitlementId }, create: { billingAccountId: acct.id, externalRef, serviceEntitlementId, status: "paid", amountCents: amount, currency, paidAt: new Date(), stripeSessionRef: pi.id }, update: { status: "paid", amountCents: amount, currency, paidAt: new Date(), stripeSessionRef: pi.id, failureCode: null, failureMessageCode: null } });
        return reply.code(200).send({ ok: true, status: "paid" });
      }
      if (pi.status === "requires_action") return reply.code(200).send({ ok: true, status: "requires_action" });
      return reply.code(200).send({ ok: true, status: "pending" });
    } catch (err) {
      const e = err as { code?: string; type?: string };
      request.log.warn({ scope: "renewal_charge", code: e?.code, type: e?.type, status: 503 }, "renewal charge failed");
      return reply.code(503).send({ ok: false, error: "charge_unavailable" });
    }
  });

  // Off-session charge for an arbitrary portal invoice (not tied to a subscription/entitlement).
  // Optionally charges an explicit saved card (by local method id, ownership-checked); otherwise
  // the customer's Stripe default. Idempotent per invoice. Returns paid | requires_action | failed.
  app.post("/v1/internal/billing/invoice-charge", async (request, reply) => {
    const token = request.headers["x-migrapay-internal-token"] as string | undefined;
    if (!token) return reply.code(401).send({ ok: false, error: "unauthorized_service" });
    if (!authorizedService(token)) return reply.code(403).send({ ok: false, error: "forbidden" });
    const body = (request.body ?? {}) as { externalRef?: string; invoiceId?: string; amountCents?: number; amount?: number; currency?: string; paymentMethodId?: string; description?: string; idempotencyKey?: string };
    const externalRef = (body.externalRef ?? "").trim();
    const invoiceId = (body.invoiceId ?? "").trim();
    const amount = Number(body.amountCents ?? body.amount);
    const currency = String(body.currency || "").toLowerCase();
    const description = (typeof body.description === "string" && body.description ? body.description : "Invoice payment").slice(0, 200);
    if (!externalRef || !invoiceId) return reply.code(400).send({ ok: false, error: "missing_params" });
    if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000) return reply.code(400).send({ ok: false, error: "invalid_amount" });
    if (currency !== "usd") return reply.code(400).send({ ok: false, error: "invalid_currency" });
    if (!config.billing.stripeSecretKey) return reply.code(503).send({ ok: false, error: "charge_unavailable" });
    const SAFE_FAILURE_CODES = ["insufficient_funds", "card_declined", "authentication_required", "expired_card", "incorrect_cvc", "processing_error", "generic_decline", "payment_failed"];
    const mapSafeFailureCode = (raw: string): string => {
      const r = String(raw || "").toLowerCase();
      if (SAFE_FAILURE_CODES.includes(r)) return r;
      switch (r) {
        case "do_not_honor": case "transaction_not_allowed": case "card_not_supported": case "currency_not_supported": case "card_velocity_exceeded": case "service_not_allowed": case "stolen_card": case "lost_card": case "pickup_card": return "card_declined";
        case "invalid_cvc": return "incorrect_cvc";
        case "invalid_expiry_year": case "invalid_expiry_month": return "expired_card";
        case "try_again_later": case "issuer_not_available": case "reenter_transaction": return "processing_error";
        case "": return "payment_failed";
        default: return "generic_decline";
      }
    };
    try {
      const acct = await db.billingAccount.findFirst({ where: { externalRef }, select: { id: true, orgId: true, stripeCustomerId: true } });
      if (!acct) return reply.code(404).send({ ok: false, error: "billing_account_not_found" });
      if (!acct.stripeCustomerId) return reply.code(409).send({ ok: false, error: "no_stripe_customer" });
      const ctx = createBillingContext({ stripeSecretKey: config.billing.stripeSecretKey, db: db as any });
      let paymentMethodId: string | null = null;
      const chosen = (body.paymentMethodId ?? "").trim();
      if (chosen) {
        const pm = await db.billingPaymentMethod.findFirst({ where: { id: chosen, orgId: acct.orgId }, select: { stripePaymentMethodId: true } });
        if (!pm) return reply.code(400).send({ ok: false, error: "invalid_payment_method" });
        paymentMethodId = pm.stripePaymentMethodId;
      } else {
        const customer: any = await ctx.stripe.customers.retrieve(acct.stripeCustomerId);
        const dpm = customer && customer.invoice_settings ? customer.invoice_settings.default_payment_method : null;
        paymentMethodId = typeof dpm === "string" ? dpm : (dpm && dpm.id) || null;
      }
      if (!paymentMethodId) return reply.code(409).send({ ok: false, error: "no_default_payment_method" });
      const idempotencyKey = (typeof body.idempotencyKey === "string" && body.idempotencyKey) ? String(body.idempotencyKey).slice(0, 200) : `invoice-charge:${externalRef}:${invoiceId}`;
      const meta = { kind: "invoice", externalRef, invoiceId, amount_cents: String(amount), currency, description };
      let pi: any;
      try {
        pi = await ctx.stripe.paymentIntents.create({ amount, currency, customer: acct.stripeCustomerId, payment_method: paymentMethodId, off_session: true, confirm: true, description, metadata: meta }, { idempotencyKey });
      } catch (e: any) {
        const declineCode = String((e && (e.decline_code || (e.raw && e.raw.decline_code) || (e.payment_intent && e.payment_intent.last_payment_error && e.payment_intent.last_payment_error.decline_code))) || "");
        const errCode = String((e && (e.code || (e.raw && e.raw.code))) || "");
        const failureCode = mapSafeFailureCode(declineCode || errCode || "payment_failed");
        if (failureCode === "authentication_required") { request.log.warn({ scope: "invoice_charge", outcome: "requires_action" }, "invoice off-session requires authentication"); return reply.code(200).send({ ok: true, status: "requires_action" }); }
        request.log.warn({ scope: "invoice_charge", outcome: "failed", failureCode }, "invoice off-session charge failed");
        return reply.code(200).send({ ok: false, status: "failed", failureCode });
      }
      if (pi.status === "succeeded") return reply.code(200).send({ ok: true, status: "paid", stripePaymentIntentId: pi.id });
      if (pi.status === "requires_action") return reply.code(200).send({ ok: true, status: "requires_action" });
      return reply.code(200).send({ ok: true, status: "pending" });
    } catch (err) {
      const e = err as { code?: string; type?: string };
      request.log.warn({ scope: "invoice_charge", code: e?.code, type: e?.type, status: 503 }, "invoice charge failed");
      return reply.code(503).send({ ok: false, error: "charge_unavailable" });
    }
  });
}
