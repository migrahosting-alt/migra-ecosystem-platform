import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireApiKeyScope } from "../../../lib/machine-auth.js";
import { requirePlatformAuthority } from "../../../lib/migraauth.js";
import {
  PRODUCT_KEYS,
} from "../../../lib/commerce-catalog.js";
import {
  USAGE_METRICS,
  assertUsageMetric,
  assertUsageProduct,
  getCommerceUsageSnapshot,
  getMachineQuotaStatus,
  recordMachineUsage,
  resolveUsageReconciliation,
  retryUsageExport,
  upsertUsageQuota,
  type UsageWindow,
} from "../../../lib/commerce-usage.js";

const usageWindowSchema = z.object({
  window: z.enum(["24h", "7d", "30d"]).default("24h"),
});

const metadataSchema = z
  .record(z.string(), z.unknown())
  .optional()
  .refine(
    (value) => !value || JSON.stringify(value).length <= 12_000,
    "Usage metadata cannot exceed 12 KB",
  );

const ingestSchema = z.object({
  product: z.enum(PRODUCT_KEYS),
  meterName: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9_.:-]+$/, "Meter name contains unsupported characters"),
  quantity: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  idempotencyKey: z.string().trim().min(8).max(255),
  occurredAt: z.string().datetime().optional(),
  metadata: metadataSchema,
});

const machineQuotaQuerySchema = z.object({
  product: z.enum(PRODUCT_KEYS),
  metric: z.enum(USAGE_METRICS),
});

const quotaParamsSchema = z.object({
  orgId: z.string().trim().min(1).max(120),
  product: z.string().trim().min(1).max(40),
  metric: z.string().trim().min(1).max(40),
});

const quotaBodySchema = z.object({
  limitValue: z
    .string()
    .trim()
    .regex(/^\d+$/, "Quota limit must be a non-negative integer"),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
});

const eventParamsSchema = z.object({
  eventId: z.string().trim().min(1).max(120),
});

const usageRetryBodySchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

const reconciliationParamsSchema = z.object({
  reportId: z.string().trim().min(1).max(120),
});

const reconciliationBodySchema = z.object({
  note: z.string().trim().max(2000).nullable().optional(),
});

export async function registerCommerceUsageRoutes(
  app: FastifyInstance,
): Promise<void> {
  // Machine-facing metering ingestion. Organization identity comes from the
  // validated API key, never from a caller-supplied x-org-id.
  app.post("/usage/events", async (request, reply) => {
    const principal = requireApiKeyScope(request, "usage:write");
    const body = ingestSchema.parse(request.body);

    const result = await recordMachineUsage({
      principal,
      product: body.product,
      meterName: body.meterName,
      quantity: body.quantity,
      idempotencyKey: body.idempotencyKey,
      ...(body.occurredAt
        ? { occurredAt: new Date(body.occurredAt) }
        : {}),
      ...(body.metadata ? { metadata: body.metadata } : {}),
    });

    return reply.code(result.duplicate ? 200 : 201).send(result);
  });

  app.get("/usage/quota", async (request) => {
    const principal = requireApiKeyScope(request, "usage:read");
    const query = machineQuotaQuerySchema.parse(request.query);

    return {
      organizationId: principal.orgId,
      product: query.product,
      metric: query.metric,
      quota: await getMachineQuotaStatus(
        principal.orgId,
        query.product,
        query.metric,
      ),
    };
  });

  // Platform-operator read model.
  app.get("/commerce/usage", async (request) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.commerce.read",
    ]);
    const query = usageWindowSchema.parse(request.query);

    return {
      authority: {
        roles: authority.roles,
        permissions: authority.permissions.filter((permission) =>
          permission.startsWith("platform.commerce."),
        ),
        viaBootstrap: authority.viaBootstrap,
      },
      canManageUsage: authority.permissions.includes(
        "platform.commerce.usage.manage",
      ),
      ...(await getCommerceUsageSnapshot(query.window as UsageWindow)),
    };
  });

  app.put(
    "/commerce/usage/quotas/:orgId/:product/:metric",
    async (request) => {
      const authority = await requirePlatformAuthority(request, [
        "platform.commerce.usage.manage",
      ]);
      const params = quotaParamsSchema.parse(request.params);
      const body = quotaBodySchema.parse(request.body);

      return {
        quota: await upsertUsageQuota({
          orgId: params.orgId,
          product: assertUsageProduct(params.product),
          metric: assertUsageMetric(params.metric),
          limitValue: BigInt(body.limitValue),
          periodStart: new Date(body.periodStart),
          periodEnd: new Date(body.periodEnd),
          actorId: authority.platformUserId,
          request,
        }),
      };
    },
  );

  app.post(
    "/commerce/usage/events/:eventId/retry",
    async (request, reply) => {
      const authority = await requirePlatformAuthority(request, [
        "platform.commerce.usage.manage",
      ]);
      const { eventId } = eventParamsSchema.parse(request.params);
      const body = usageRetryBodySchema.parse(request.body);

      return reply.code(202).send({
        event: await retryUsageExport({
          eventId,
          actorId: authority.platformUserId,
          reason: body.reason,
          request,
        }),
      });
    },
  );

  app.post(
    "/commerce/usage/reconciliation/:reportId/resolve",
    async (request) => {
      const authority = await requirePlatformAuthority(request, [
        "platform.commerce.usage.manage",
      ]);
      const { reportId } = reconciliationParamsSchema.parse(request.params);
      const body = reconciliationBodySchema.parse(request.body ?? {});

      return {
        report: await resolveUsageReconciliation({
          reportId,
          actorId: authority.platformUserId,
          request,
          note: body.note ?? null,
        }),
      };
    },
  );
}
