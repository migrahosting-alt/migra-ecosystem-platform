/**
 * Billing routes — commercial state for organizations.
 *
 * Wires @migrateck/billing-core into the auth-api surface.
 * All GET routes serve live data from the billing tables.
 * The webhook route ingests Stripe events and drives billing state.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createBillingContext } from "@migrateck/billing-core";
import { getOrCreateBillingAccount } from "@migrateck/billing-core/customers";
import { findCatalogPlan } from "@migrateck/billing-core/catalog";
import { constructEvent, processWebhookEvent } from "@migrateck/billing-core/webhooks";
import { db } from "../lib/db.js";
import { config } from "../config/env.js";
import { requireAuthenticatedUser, getClientIp } from "../middleware/session.js";
import { logAuditEvent } from "../modules/audit/index.js";

// ── Helpers ──────────────────────────────────────────────────────────

function getOrgId(request: { headers: Record<string, unknown> }): string | null {
  const v = (request as any).headers["x-org-id"];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function billingNotConfigured(reply: any) {
  return reply.code(503).send({
    error: { code: "billing_not_configured", message: "Billing is not configured on this server." },
  });
}

function missingOrgId(reply: any) {
  return reply.code(400).send({
    error: { code: "missing_org_id", message: "x-org-id header is required." },
  });
}

function serializeBillingAccount(account: {
  id: string;
  orgId: string;
  status: string | null;
  billingEmail: string | null;
  billingContactName: string | null;
  stripeCustomerId: string | null;
  taxCountry: string | null;
  taxState: string | null;
  taxId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: account.id,
    orgId: account.orgId,
    status: account.status?.toLowerCase() ?? "active",
    billingEmail: account.billingEmail ?? null,
    billingContactName: account.billingContactName ?? null,
    stripeCustomerId: account.stripeCustomerId ?? null,
    taxCountry: account.taxCountry ?? null,
    taxState: account.taxState ?? null,
    taxId: account.taxId ?? null,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

/**
 * Resolve org entitlements from active subscriptions + manual overrides.
 * Pure DB operation — does not require Stripe.
 */
async function resolveOrgEntitlements(orgId: string): Promise<Record<string, string | number | boolean>> {
  const merged: Record<string, string | number | boolean> = {};

  // 1. Active/trialing subscriptions → catalog plan entitlements
  const subscriptions = await db.billingSubscription.findMany({
    where: { orgId, status: { in: ["ACTIVE", "TRIALING"] } },
  });

  for (const sub of subscriptions) {
    const plan = findCatalogPlan(sub.productFamily as any, sub.planCode as any);
    if (!plan) continue;
    for (const [key, value] of Object.entries(plan.entitlements)) {
      mergeValue(merged, key, value as string | number | boolean);
    }
  }

  // 2. Manual overrides (most recent, non-expired)
  const overrides = await db.billingEntitlementSnapshot.findMany({
    where: {
      orgId,
      sourceType: "MANUAL_OVERRIDE",
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { effectiveAt: "desc" },
    take: 1,
  });

  if (overrides.length > 0) {
    const overrideJson = (overrides[0]?.entitlementsJson ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(overrideJson)) {
      if (value !== undefined && value !== null) {
        merged[key] = value as string | number | boolean;
      }
    }
  }

  return merged;
}

function mergeValue(
  acc: Record<string, string | number | boolean>,
  key: string,
  value: string | number | boolean,
): void {
  const existing = acc[key];
  if (existing === undefined) {
    acc[key] = value;
    return;
  }
  if (typeof value === "boolean" && typeof existing === "boolean") {
    if (value === true) acc[key] = true;
    return;
  }
  if (typeof value === "number" && typeof existing === "number") {
    acc[key] = value === -1 || existing === -1 ? -1 : Math.max(existing, value);
    return;
  }
  // String: last write wins
  acc[key] = value;
}

const provisionBodySchema = z.object({
  orgId: z.string().uuid("orgId must be a valid UUID."),
});

// ── Route Registration ────────────────────────────────────────────────

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /v1/billing/account/provision ──────────────────────────
  // Idempotent bootstrap: create local billing account + Stripe customer.
  // Restricted to org OWNER / ADMIN only. Temporary bootstrap path.

  app.post("/v1/billing/account/provision", { preHandler: requireAuthenticatedUser }, async (request, reply) => {
    if (!config.billing.stripeSecretKey) return billingNotConfigured(reply);

    const user = request.authUser!;
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];

    let body: z.infer<typeof provisionBodySchema>;
    try {
      const raw = request.body instanceof Buffer
        ? JSON.parse((request.body as Buffer).toString("utf-8"))
        : request.body;
      body = provisionBodySchema.parse(raw);
    } catch (err: any) {
      return reply.code(400).send({ error: { code: "validation_error", message: err.errors?.[0]?.message ?? "Invalid request body." } });
    }

    const { orgId } = body;

    // ── Authorization: caller must be OWNER or ADMIN of the org ──
    const membership = await db.organizationMember.findFirst({
      where: { organizationId: orgId, userId: user.id, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } },
    });

    if (!membership) {
      return reply.code(403).send({ error: { code: "forbidden", message: "You must be an owner or admin of this organization to provision billing." } });
    }

    // ── Idempotency: return existing account without touching Stripe ──
    const existing = await db.billingAccount.findUnique({ where: { orgId } });

    if (existing) {
      await logAuditEvent({
        actorUserId: user.id,
        eventType: "BILLING_ACCOUNT_PROVISION_SKIPPED_ALREADY_EXISTS",
        eventData: { orgId, billingAccountId: existing.id, stripeCustomerId: existing.stripeCustomerId ?? null },
        ipAddress: ip,
        userAgent: ua,
      });

      return reply.code(200).send({
        ok: true,
        created: false,
        billingAccount: serializeBillingAccount(existing),
      });
    }

    // ── Provision: resolve org info then create Stripe customer + DB record ──
    const org = await db.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true } });
    if (!org) {
      return reply.code(404).send({ error: { code: "org_not_found", message: "Organization not found." } });
    }

    const billingCtx = createBillingContext({
      stripeSecretKey: config.billing.stripeSecretKey!,
      db: db as any,
    });

    const account = await getOrCreateBillingAccount(billingCtx, {
      orgId,
      orgName: org.name,
      billingEmail: user.email,
    });

    await logAuditEvent({
      actorUserId: user.id,
      eventType: "BILLING_ACCOUNT_PROVISIONED",
      eventData: { orgId, billingAccountId: account.id, stripeCustomerId: account.stripeCustomerId ?? null },
      ipAddress: ip,
      userAgent: ua,
    });

    return reply.code(201).send({
      ok: true,
      created: true,
      billingAccount: serializeBillingAccount(account),
    });
  });

  // ── GET /v1/billing/account ─────────────────────────────────────

  app.get("/v1/billing/account", { preHandler: requireAuthenticatedUser }, async (request, reply) => {
    const orgId = getOrgId(request);
    if (!orgId) return missingOrgId(reply);

    const account = await db.billingAccount.findUnique({ where: { orgId } });

    if (!account) {
      return reply.code(404).send({
        error: { code: "billing_account_not_found", message: "No billing account for this organization." },
      });
    }

    return reply.code(200).send(serializeBillingAccount(account));
  });

  // ── GET /v1/billing/subscriptions ───────────────────────────────

  app.get("/v1/billing/subscriptions", { preHandler: requireAuthenticatedUser }, async (request, reply) => {
    const orgId = getOrgId(request);
    if (!orgId) return missingOrgId(reply);

    const subscriptions = await db.billingSubscription.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
    });

    return reply.code(200).send(
      subscriptions.map((s: any) => ({
        id: s.id,
        productFamily: s.productFamily,
        planCode: s.planCode,
        status: s.status?.toLowerCase() ?? "incomplete",
        billingInterval: s.billingInterval?.toLowerCase() ?? "month",
        currentPeriodEnd: s.currentPeriodEnd?.toISOString() ?? null,
        cancelAtPeriodEnd: s.cancelAtPeriodEnd ?? false,
      })),
    );
  });

  // ── GET /v1/billing/invoices ────────────────────────────────────

  app.get("/v1/billing/invoices", { preHandler: requireAuthenticatedUser }, async (request, reply) => {
    const orgId = getOrgId(request);
    if (!orgId) return missingOrgId(reply);

    const invoices = await db.billingInvoice.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      take: 24,
    });

    return reply.code(200).send(
      invoices.map((inv: any) => ({
        id: inv.id,
        status: inv.status?.toLowerCase() ?? "draft",
        total: inv.total,
        currency: inv.currency,
        issuedAt: inv.issuedAt?.toISOString() ?? null,
        paidAt: inv.paidAt?.toISOString() ?? null,
        hostedInvoiceUrl: inv.hostedInvoiceUrl ?? null,
        invoicePdf: inv.invoicePdf ?? null,
      })),
    );
  });

  // ── GET /v1/billing/payment-methods ────────────────────────────

  app.get("/v1/billing/payment-methods", { preHandler: requireAuthenticatedUser }, async (request, reply) => {
    const orgId = getOrgId(request);
    if (!orgId) return missingOrgId(reply);

    const methods = await db.billingPaymentMethod.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
    });

    return reply.code(200).send(
      methods.map((m: any) => ({
        id: m.id,
        type: m.type,
        brand: m.brand ?? null,
        last4: m.last4 ?? null,
        expMonth: m.expMonth ?? null,
        expYear: m.expYear ?? null,
        isDefault: m.isDefault ?? false,
      })),
    );
  });

  // ── GET /v1/billing/tax ─────────────────────────────────────────

  app.get("/v1/billing/tax", { preHandler: requireAuthenticatedUser }, async (request, reply) => {
    const orgId = getOrgId(request);
    if (!orgId) return missingOrgId(reply);

    const account = await db.billingAccount.findUnique({ where: { orgId } });

    if (!account) {
      return reply.code(200).send({ taxCountry: null, taxState: null, taxId: null });
    }

    return reply.code(200).send({
      taxCountry: account.taxCountry ?? null,
      taxState: account.taxState ?? null,
      taxId: account.taxId ?? null,
    });
  });

  // ── GET /v1/billing/entitlements ───────────────────────────────

  app.get("/v1/billing/entitlements", { preHandler: requireAuthenticatedUser }, async (request, reply) => {
    const orgId = getOrgId(request);
    if (!orgId) return missingOrgId(reply);

    const entitlements = await resolveOrgEntitlements(orgId);
    return reply.code(200).send(entitlements);
  });

  // ── GET /v1/billing/usage/summary ──────────────────────────────

  app.get("/v1/billing/usage/summary", { preHandler: requireAuthenticatedUser }, async (request, reply) => {
    const orgId = getOrgId(request);
    if (!orgId) return missingOrgId(reply);

    const groups = await db.billingUsageEvent.groupBy({
      by: ["productFamily", "meterName"],
      where: { orgId },
      _sum: { quantity: true },
      _count: { id: true },
    });

    return reply.code(200).send(
      groups.map((g: any) => ({
        productFamily: g.productFamily,
        meterName: g.meterName,
        totalQuantity: g._sum.quantity ?? 0,
        eventCount: g._count.id ?? 0,
      })),
    );
  });

  // ── GET /v1/billing/dunning ─────────────────────────────────────

  app.get("/v1/billing/dunning", { preHandler: requireAuthenticatedUser }, async (request, reply) => {
    const orgId = getOrgId(request);
    if (!orgId) return missingOrgId(reply);

    const account = await db.billingAccount.findUnique({ where: { orgId } });

    return reply.code(200).send({
      dunningState: account?.dunningState?.toLowerCase() ?? "unknown",
    });
  });

  // ── POST /v1/billing/webhooks/stripe ───────────────────────────
  // Raw body required for Stripe signature verification.

  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => {
    done(null, body);
  });

  app.post("/v1/billing/webhooks/stripe", async (request, reply) => {
    if (!config.billing.stripeSecretKey || !config.billing.stripeWebhookSecret) {
      return billingNotConfigured(reply);
    }

    const signature = (request.headers as any)["stripe-signature"];
    if (!signature) {
      return reply.code(400).send({ error: { code: "missing_signature", message: "stripe-signature header required." } });
    }

    const billingCtx = createBillingContext({
      stripeSecretKey: config.billing.stripeSecretKey!,
      db: db as any,
    });

    let event;
    try {
      event = constructEvent(billingCtx, request.body as Buffer, signature, config.billing.stripeWebhookSecret!);
    } catch (err: any) {
      return reply.code(400).send({ error: { code: "invalid_signature", message: err.message } });
    }

    const result = await processWebhookEvent(billingCtx, event);

    return reply.code(200).send({ received: true, eventId: result.eventId, status: result.status });
  });
}
