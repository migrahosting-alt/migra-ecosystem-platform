import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireOrganizationPrincipal } from "../../../lib/migraauth.js";
import {
  WEBHOOK_EVENT_CATALOG,
  createWebhookEndpoint,
  disableWebhookEndpoint,
  enqueueTestDelivery,
  listWebhookDeliveries,
  listWebhookEndpoints,
  replayWebhookDelivery,
  rotateWebhookSecret,
  updateWebhookEndpoint,
} from "../../../lib/webhooks.js";

const eventNames = WEBHOOK_EVENT_CATALOG.map((entry) => entry.event);
const eventSchema = z.string().refine((value) => eventNames.includes(value), {
  message: "Unsupported webhook event type.",
});

const endpointParams = z.object({
  endpointId: z.string().trim().min(1).max(120),
});

const deliveryParams = z.object({
  deliveryId: z.string().trim().min(1).max(120),
});

const createSchema = z.object({
  url: z.string().trim().url().max(1000),
  description: z.string().trim().max(500).nullable().optional(),
  events: z.array(eventSchema).min(1).max(50),
});

const updateSchema = z.object({
  url: z.string().trim().url().max(1000).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  events: z.array(eventSchema).min(1).max(50).optional(),
  status: z.enum(["ACTIVE", "PAUSED"]).optional(),
}).refine((body) => Object.keys(body).length > 0, {
  message: "At least one webhook setting must be provided.",
});

const deliveryQuery = z.object({
  endpointId: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function registerWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.get("/developer/webhooks/catalog", async () => ({
    events: WEBHOOK_EVENT_CATALOG,
    signature: {
      algorithm: "HMAC-SHA256",
      header: "X-MigraTeck-Signature",
      timestampHeader: "X-MigraTeck-Timestamp",
      signedPayload: "<timestamp>.<raw-request-body>",
    },
  }));

  app.get("/developer/webhooks", async (request) => {
    const principal = await requireOrganizationPrincipal(request);
    return {
      organization: {
        id: principal.membership.id,
        name: principal.membership.name,
        slug: principal.membership.slug,
        role: principal.membership.role,
      },
      endpoints: await listWebhookEndpoints(principal.platformOrgId),
      eventCatalog: WEBHOOK_EVENT_CATALOG,
    };
  });

  app.post("/developer/webhooks", async (request, reply) => {
    const principal = await requireOrganizationPrincipal(request);
    const body = createSchema.parse(request.body);

    const created = await createWebhookEndpoint({
      orgId: principal.platformOrgId,
      userId: principal.platformUserId,
      url: body.url,
      events: body.events,
      description: body.description ?? null,
      request,
    });

    return reply.code(201).send({
      endpoint: created.endpoint,
      signingSecret: created.signingSecret,
      warning: "Copy the signing secret now. MigraTeck will not display it again.",
    });
  });

  app.patch("/developer/webhooks/:endpointId", async (request) => {
    const principal = await requireOrganizationPrincipal(request);
    const { endpointId } = endpointParams.parse(request.params);
    const body = updateSchema.parse(request.body);

    await updateWebhookEndpoint({
      orgId: principal.platformOrgId,
      userId: principal.platformUserId,
      endpointId,
      ...(body.url !== undefined ? { url: body.url } : {}),
      ...(body.events !== undefined ? { events: body.events } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      request,
    });

    return { updated: true };
  });

  app.delete("/developer/webhooks/:endpointId", async (request) => {
    const principal = await requireOrganizationPrincipal(request);
    const { endpointId } = endpointParams.parse(request.params);

    await disableWebhookEndpoint({
      orgId: principal.platformOrgId,
      userId: principal.platformUserId,
      endpointId,
      request,
    });
    return { disabled: true };
  });

  app.post("/developer/webhooks/:endpointId/rotate-secret", async (request) => {
    const principal = await requireOrganizationPrincipal(request);
    const { endpointId } = endpointParams.parse(request.params);
    const signingSecret = await rotateWebhookSecret({
      orgId: principal.platformOrgId,
      userId: principal.platformUserId,
      endpointId,
      request,
    });

    return {
      signingSecret,
      warning: "Copy the new signing secret now. The previous secret is invalid immediately.",
    };
  });

  app.post("/developer/webhooks/:endpointId/test", async (request, reply) => {
    const principal = await requireOrganizationPrincipal(request);
    const { endpointId } = endpointParams.parse(request.params);
    const deliveryId = await enqueueTestDelivery({
      orgId: principal.platformOrgId,
      userId: principal.platformUserId,
      endpointId,
      request,
    });

    return reply.code(202).send({ deliveryId, queued: true });
  });

  app.get("/developer/webhooks/deliveries", async (request) => {
    const principal = await requireOrganizationPrincipal(request);
    const query = deliveryQuery.parse(request.query);
    return {
      deliveries: await listWebhookDeliveries(
        principal.platformOrgId,
        query.endpointId,
        query.limit,
      ),
    };
  });

  app.post("/developer/webhooks/deliveries/:deliveryId/replay", async (request, reply) => {
    const principal = await requireOrganizationPrincipal(request);
    const { deliveryId } = deliveryParams.parse(request.params);
    const replayId = await replayWebhookDelivery({
      orgId: principal.platformOrgId,
      userId: principal.platformUserId,
      deliveryId,
      request,
    });

    return reply.code(202).send({ deliveryId: replayId, replayedFrom: deliveryId });
  });
}
