
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePlatformAuthority } from "../../../lib/migraauth.js";
import {
  getBillingOperationsOverview,
  getOrganizationBillingOperations,
  initializeOrganizationBillingCustomer,
  operateSubscription,
  reconcileOrganizationBilling,
} from "../../../lib/commerce-billing.js";

const overviewQuerySchema = z.object({
  q: z.string().trim().max(160).default(""),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const orgParamsSchema = z.object({
  orgId: z.string().trim().min(1).max(120),
});

const subscriptionParamsSchema = z.object({
  orgId: z.string().trim().min(1).max(120),
  subscriptionId: z.string().trim().min(1).max(160),
});

const reconcileSchema = z.object({
  operationId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
});

const initializeCustomerSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("create"),
    operationId: z.string().uuid(),
    reason: z.string().trim().min(3).max(500),
    billingEmail: z.string().trim().email().max(320),
  }),
  z.object({
    mode: z.literal("link_existing"),
    operationId: z.string().uuid(),
    reason: z.string().trim().min(3).max(500),
    externalCustomerId: z.string().trim().min(6).max(255),
  }),
]);

const subscriptionActionSchema = z.object({
  operationId: z.string().uuid(),
  action: z.enum([
    "pause_collection",
    "resume_collection",
    "cancel_at_period_end",
    "keep_active",
    "cancel_immediate",
  ]),
  reason: z.string().trim().min(3).max(500),
  expectedUpdatedAt: z.string().datetime().nullable().optional(),
});

export async function registerCommerceBillingRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/commerce/billing", async (request) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.commerce.read",
    ]);
    const query = overviewQuerySchema.parse(request.query);

    return {
      authority: {
        roles: authority.roles,
        viaBootstrap: authority.viaBootstrap,
        canManageBilling: authority.permissions.includes(
          "platform.commerce.billing.manage",
        ),
        managementPermission: "platform.commerce.billing.manage",
      },
      ...(await getBillingOperationsOverview(query.q, query.limit)),
    };
  });

  app.get("/commerce/billing/organizations/:orgId", async (request) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.commerce.read",
    ]);
    const { orgId } = orgParamsSchema.parse(request.params);

    return {
      canManageBilling: authority.permissions.includes(
        "platform.commerce.billing.manage",
      ),
      managementPermission: "platform.commerce.billing.manage",
      ...(await getOrganizationBillingOperations(orgId)),
    };
  });

  app.post(
    "/commerce/billing/organizations/:orgId/customer",
    async (request) => {
      const authority = await requirePlatformAuthority(request, [
        "platform.commerce.billing.manage",
      ]);
      const { orgId } = orgParamsSchema.parse(request.params);
      const body = initializeCustomerSchema.parse(request.body);

      return initializeOrganizationBillingCustomer({
        orgId,
        actorId: authority.platformUserId,
        operationId: body.operationId,
        mode: body.mode,
        billingEmail: body.mode === "create" ? body.billingEmail : null,
        externalCustomerId:
          body.mode === "link_existing" ? body.externalCustomerId : null,
        reason: body.reason,
        ip: request.ip ?? null,
        userAgent: request.headers["user-agent"] ?? null,
      });
    },
  );

  app.post(
    "/commerce/billing/organizations/:orgId/reconcile",
    async (request) => {
      const authority = await requirePlatformAuthority(request, [
        "platform.commerce.billing.manage",
      ]);
      const { orgId } = orgParamsSchema.parse(request.params);
      const body = reconcileSchema.parse(request.body);

      return reconcileOrganizationBilling({
        orgId,
        operationId: body.operationId,
        reason: body.reason,
        actorId: authority.platformUserId,
        ip: request.ip ?? null,
        userAgent: request.headers["user-agent"] ?? null,
      });
    },
  );

  app.post(
    "/commerce/billing/organizations/:orgId/subscriptions/:subscriptionId/action",
    async (request) => {
      const authority = await requirePlatformAuthority(request, [
        "platform.commerce.billing.manage",
      ]);
      const { orgId, subscriptionId } = subscriptionParamsSchema.parse(
        request.params,
      );
      const body = subscriptionActionSchema.parse(request.body);

      return operateSubscription({
        orgId,
        subscriptionId,
        action: body.action,
        operationId: body.operationId,
        reason: body.reason,
        ...(body.expectedUpdatedAt !== undefined
          ? { expectedUpdatedAt: body.expectedUpdatedAt }
          : {}),
        actorId: authority.platformUserId,
        ip: request.ip ?? null,
        userAgent: request.headers["user-agent"] ?? null,
      });
    },
  );
}
