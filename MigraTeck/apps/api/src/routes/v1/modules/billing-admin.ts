import type { FastifyInstance, FastifyRequest } from "fastify";
import { requirePlatformAuthority } from "../../../lib/migraauth.js";
import { createBillingContext, type BillingContext } from "@migrateck/billing-core";
import {
  issueAdjustment,
  overrideEntitlements,
  reconcileOrg,
  retryFailedWebhooks,
} from "@migrateck/billing-core/support-actions";
import {
  resolveAndSnapshotEntitlements,
} from "@migrateck/billing-core/entitlements";
import {
  issueCreditsSchema,
  overrideEntitlementsSchema,
} from "@migrateck/billing-core/schemas";
import { getBillingAccount } from "@migrateck/billing-core/customers";
import { getSubscriptions } from "@migrateck/billing-core/subscriptions";
import { getDunningState } from "@migrateck/billing-core/dunning";

// ─── Context ────────────────────────────────────────────────────────

let _billingCtx: BillingContext | null = null;

function getBillingCtx(): BillingContext {
  if (!_billingCtx) {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not configured");
    _billingCtx = createBillingContext({
      stripeSecretKey: stripeKey,
      db: (globalThis as any).__billingDb,
    });
  }
  return _billingCtx;
}

// ─── Helpers ────────────────────────────────────────────────────────

async function requireAdminAuth(
  request: FastifyRequest,
  permissions: readonly string[],
) {
  return requirePlatformAuthority(request, permissions);
}

// ─── Admin Routes ───────────────────────────────────────────────────

export async function registerBillingAdminRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ── Org overview ───────────────────────────────────────────────

  app.get<{ Params: { orgId: string } }>(
    "/admin/billing/orgs/:orgId",
    async (request) => {
      await requireAdminAuth(request, ["platform.commerce.read"]);
      const ctx = getBillingCtx();
      const { orgId } = request.params;

      const [account, subscriptions, dunningState] = await Promise.all([
        getBillingAccount(ctx, orgId),
        getSubscriptions(ctx, orgId),
        getDunningState(ctx, orgId),
      ]);

      return { account, subscriptions, dunningState };
    },
  );

  // ── Issue credits/adjustments ──────────────────────────────────

  app.post<{ Params: { orgId: string } }>(
    "/admin/billing/orgs/:orgId/credits",
    async (request) => {
      const authority = await requireAdminAuth(request, ["platform.commerce.billing.manage"]);
      const ctx = getBillingCtx();
      const body = issueCreditsSchema.parse(request.body);

      return issueAdjustment(ctx, {
        orgId: request.params.orgId,
        kind: body.kind,
        amount: body.amount,
        currency: body.currency,
        reason: body.reason,
        createdByUserId: authority.platformUserId,
        stripeInvoiceId: body.stripeInvoiceId,
      });
    },
  );

  // ── Override entitlements ──────────────────────────────────────

  app.post<{ Params: { orgId: string } }>(
    "/admin/billing/orgs/:orgId/override-entitlements",
    async (request) => {
      const authority = await requireAdminAuth(request, ["platform.commerce.entitlements.manage"]);
      const ctx = getBillingCtx();
      const body = overrideEntitlementsSchema.parse(request.body);

      await overrideEntitlements(ctx, {
        orgId: request.params.orgId,
        entitlements: body.entitlements,
        reason: body.reason,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
        createdByUserId: authority.platformUserId,
      });

      return { ok: true };
    },
  );

  // ── Reconcile ─────────────────────────────────────────────────

  app.post<{ Params: { orgId: string } }>(
    "/admin/billing/orgs/:orgId/reconcile",
    async (request) => {
      await requireAdminAuth(request, ["platform.commerce.billing.manage"]);
      const ctx = getBillingCtx();
      return reconcileOrg(ctx, request.params.orgId);
    },
  );

  // ── Re-resolve entitlements ────────────────────────────────────

  app.post<{ Params: { orgId: string } }>(
    "/admin/billing/orgs/:orgId/resolve-entitlements",
    async (request) => {
      await requireAdminAuth(request, ["platform.commerce.entitlements.manage"]);
      const ctx = getBillingCtx();
      return resolveAndSnapshotEntitlements(ctx, request.params.orgId);
    },
  );

  // ── Retry failed webhooks ──────────────────────────────────────

  app.post("/admin/billing/retry-webhooks", async (request) => {
    await requireAdminAuth(request, ["platform.commerce.billing.manage"]);
    const ctx = getBillingCtx();
    return retryFailedWebhooks(ctx);
  });
}
