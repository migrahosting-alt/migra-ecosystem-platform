import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePlatformAuthority } from "../../../lib/migraauth.js";
import {
  ENTITLEMENT_STATUSES,
  PRODUCT_KEYS,
  getCommerceCatalogSnapshot,
  getOrganizationCommerceAccess,
  searchCommerceOrganizations,
  upsertBillingBinding,
} from "../../../lib/commerce-catalog.js";
import {
  buildEntitlementTransitionMatrix,
  getProvisioningWorkerStatus,
  mutateOrganizationEntitlement,
} from "../../../lib/commerce-entitlements.js";
import {
  cancelDeadProvisioningJob,
  getDeadLetterRemediation,
  retryDeadProvisioningJob,
} from "../../../lib/provisioning-remediation.js";

const organizationQuerySchema = z.object({
  q: z.string().trim().max(120).default(""),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

const organizationParamsSchema = z.object({
  orgId: z.string().trim().min(1).max(120),
});

const bindingParamsSchema = z.object({
  externalPriceId: z.string().trim().min(3).max(255),
});

const bindingSchema = z.object({
  product: z.enum(PRODUCT_KEYS),
  statusOnActive: z.enum(ENTITLEMENT_STATUSES).default("ACTIVE"),
  notes: z.string().trim().max(2000).nullable().optional(),
});

const entitlementParamsSchema = z.object({
  orgId: z.string().trim().min(1).max(120),
  product: z.enum(PRODUCT_KEYS),
});

const entitlementContextSchema = z.object({
  domain: z.string().trim().min(1).max(253).optional(),
  tenantId: z.string().trim().min(1).max(255).optional(),
  serviceInstanceId: z.string().trim().min(1).max(255).optional(),
  targetIp: z.string().trim().min(1).max(64).optional(),
  plan: z.string().trim().min(1).max(255).optional(),
  limits: z.record(z.string(), z.unknown()).optional(),
  mailboxEmail: z.string().trim().email().max(320).optional(),
  mailboxPassword: z
    .string()
    .min(12)
    .max(256)
    .refine((value) => value.trim().length >= 12, {
      message: "Mailbox password must contain at least 12 non-whitespace characters",
    })
    .optional(),
  mailboxQuotaMb: z.number().int().positive().max(1_000_000).optional(),
}).default({});

const entitlementMutationSchema = z.object({
  status: z.enum(ENTITLEMENT_STATUSES),
  expectedUpdatedAt: z.string().datetime().nullable().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  reason: z.string().trim().min(3).max(500),
  acknowledgeBillingOverride: z.boolean().default(false),
  context: entitlementContextSchema,
});

const provisioningJobParamsSchema = z.object({
  jobId: z.string().trim().min(1).max(120),
});

const deadLetterRecoveryContextSchema = z.object({
  domain: z.string().trim().min(1).max(253).optional(),
  tenantId: z.string().trim().min(1).max(255).optional(),
  serviceInstanceId: z.string().trim().min(1).max(255).optional(),
  targetIp: z.string().trim().min(1).max(64).optional(),
  plan: z.string().trim().min(1).max(255).optional(),
  mailboxEmail: z.string().trim().email().max(320).optional(),
}).default({});

const deadLetterRetrySchema = z.object({
  reason: z.string().trim().min(3).max(500),
  context: deadLetterRecoveryContextSchema,
});

const deadLetterCancelSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export async function registerCommerceCatalogRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/commerce/catalog", async (request) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.commerce.read",
    ]);

    const worker = await getProvisioningWorkerStatus();

    return {
      authority: {
        roles: authority.roles,
        permissions: authority.permissions.filter((permission) =>
          permission.startsWith("platform.commerce."),
        ),
        viaBootstrap: authority.viaBootstrap,
      },
      ...(await getCommerceCatalogSnapshot()),
      mutationReadiness: {
        bindings: authority.permissions.includes("platform.commerce.catalog.manage"),
        entitlements: authority.permissions.includes(
          "platform.commerce.entitlements.manage",
        ),
        entitlementReason: authority.permissions.includes(
          "platform.commerce.entitlements.manage",
        )
          ? "Each transition is evaluated independently. Unsafe product lanes remain locked."
          : "platform.commerce.entitlements.manage is required.",
        worker,
      },
    };
  });

  app.get("/commerce/organizations", async (request) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.commerce.read",
    ]);
    const query = organizationQuerySchema.parse(request.query);

    return {
      canManageEntitlements: authority.permissions.includes(
        "platform.commerce.entitlements.manage",
      ),
      organizations: await searchCommerceOrganizations(query.q, query.limit),
    };
  });

  app.get("/commerce/organizations/:orgId/entitlements", async (request) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.commerce.read",
    ]);
    const { orgId } = organizationParamsSchema.parse(request.params);
    const access = await getOrganizationCommerceAccess(orgId);
    const readiness = await buildEntitlementTransitionMatrix({
      orgSlug: access.organization.slug,
      entitlements: access.entitlements,
    });

    return {
      canManageEntitlements: authority.permissions.includes(
        "platform.commerce.entitlements.manage",
      ),
      ...access,
      ...readiness,
    };
  });

  app.put(
    "/commerce/organizations/:orgId/entitlements/:product",
    async (request, reply) => {
      const authority = await requirePlatformAuthority(request, [
        "platform.commerce.entitlements.manage",
      ]);
      const { orgId, product } = entitlementParamsSchema.parse(request.params);
      const body = entitlementMutationSchema.parse(request.body);

      const result = await mutateOrganizationEntitlement({
        orgId,
        actorId: authority.platformUserId,
        product,
        newStatus: body.status,
        expectedUpdatedAt: body.expectedUpdatedAt,
        startsAt: body.startsAt,
        endsAt: body.endsAt,
        notes: body.notes,
        reason: body.reason,
        acknowledgeBillingOverride: body.acknowledgeBillingOverride,
        context: body.context,
        ip: request.ip ?? null,
        userAgent: request.headers["user-agent"] ?? null,
      });

      return reply.code(200).send(result);
    },
  );

  app.get(
    "/commerce/provisioning/jobs/:jobId/remediation",
    async (request) => {
      const authority = await requirePlatformAuthority(request, [
        "platform.commerce.read",
      ]);
      const { jobId } = provisioningJobParamsSchema.parse(request.params);
      return getDeadLetterRemediation(jobId, {
        includeHostingSuggestions: authority.permissions.includes(
          "platform.hosting.read",
        ),
      });
    },
  );

  app.post(
    "/commerce/provisioning/jobs/:jobId/retry",
    async (request, reply) => {
      const authority = await requirePlatformAuthority(request, [
        "platform.commerce.entitlements.manage",
      ]);
      const { jobId } = provisioningJobParamsSchema.parse(request.params);
      const body = deadLetterRetrySchema.parse(request.body);
      const result = await retryDeadProvisioningJob({
        jobId,
        actorId: authority.platformUserId,
        reason: body.reason,
        context: body.context,
        ip: request.ip ?? null,
        userAgent: request.headers["user-agent"] ?? null,
      });
      return reply.code(202).send(result);
    },
  );

  app.post(
    "/commerce/provisioning/jobs/:jobId/cancel",
    async (request) => {
      const authority = await requirePlatformAuthority(request, [
        "platform.commerce.entitlements.manage",
      ]);
      const { jobId } = provisioningJobParamsSchema.parse(request.params);
      const body = deadLetterCancelSchema.parse(request.body);
      return cancelDeadProvisioningJob({
        jobId,
        actorId: authority.platformUserId,
        reason: body.reason,
        ip: request.ip ?? null,
        userAgent: request.headers["user-agent"] ?? null,
      });
    },
  );

  app.put("/commerce/bindings/:externalPriceId", async (request, reply) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.commerce.catalog.manage",
    ]);
    const { externalPriceId } = bindingParamsSchema.parse(request.params);
    const body = bindingSchema.parse(request.body);

    const binding = await upsertBillingBinding({
      actorId: authority.platformUserId,
      externalPriceId,
      product: body.product,
      statusOnActive: body.statusOnActive,
      notes: body.notes ?? null,
      request,
    });

    return reply.code(200).send({ binding });
  });
}
