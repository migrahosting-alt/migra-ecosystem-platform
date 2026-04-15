import type { FastifyInstance, FastifyRequest } from "fastify";
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

function requireAdminAuth(request: FastifyRequest): string {
  const role = request.headers["x-user-role"] as string | undefined;
  if (role !== "PLATFORM_ADMIN" && role !== "SUPPORT") {
    throw Object.assign(new Error("Forbidden: admin access required"), {
      statusCode: 403,
    });
  }
  const userId = request.headers["x-user-id"] as string | undefined;
  if (!userId)
    throw Object.assign(new Error("Missing x-user-id header"), { statusCode: 400 });
  return userId;
}

// ─── Admin Routes ───────────────────────────────────────────────────

export async function registerBillingAdminRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ── Org overview ───────────────────────────────────────────────

  app.get<{ Params: { orgId: string } }>(
    "/admin/billing/orgs/:orgId",
    async (request) => {
      requireAdminAuth(request);
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
      const userId = requireAdminAuth(request);
      const ctx = getBillingCtx();
      const body = issueCreditsSchema.parse(request.body);

      return issueAdjustment(ctx, {
        orgId: request.params.orgId,
        kind: body.kind,
        amount: body.amount,
        currency: body.currency,
        reason: body.reason,
        createdByUserId: userId,
        stripeInvoiceId: body.stripeInvoiceId,
      });
    },
  );

  // ── Override entitlements ──────────────────────────────────────

  app.post<{ Params: { orgId: string } }>(
    "/admin/billing/orgs/:orgId/override-entitlements",
    async (request) => {
      const userId = requireAdminAuth(request);
      const ctx = getBillingCtx();
      const body = overrideEntitlementsSchema.parse(request.body);

      await overrideEntitlements(ctx, {
        orgId: request.params.orgId,
        entitlements: body.entitlements,
        reason: body.reason,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
        createdByUserId: userId,
      });

      return { ok: true };
    },
  );

  // ── Reconcile ─────────────────────────────────────────────────

  app.post<{ Params: { orgId: string } }>(
    "/admin/billing/orgs/:orgId/reconcile",
    async (request) => {
      requireAdminAuth(request);
      const ctx = getBillingCtx();
      return reconcileOrg(ctx, request.params.orgId);
    },
  );

  // ── Re-resolve entitlements ────────────────────────────────────

  app.post<{ Params: { orgId: string } }>(
    "/admin/billing/orgs/:orgId/resolve-entitlements",
    async (request) => {
      requireAdminAuth(request);
      const ctx = getBillingCtx();
      return resolveAndSnapshotEntitlements(ctx, request.params.orgId);
    },
  );

  // ── Retry failed webhooks ──────────────────────────────────────

  app.post("/admin/billing/retry-webhooks", async (request) => {
    requireAdminAuth(request);
    const ctx = getBillingCtx();
    return retryFailedWebhooks(ctx);
  });
}
