import type { FastifyInstance } from "fastify";
import {
  createOAuthClientSchema,
  oauthClientIdSchema,
  updateOAuthClientSchema,
} from "../lib/schemas.js";
import { requireSession, getClientIp } from "../middleware/session.js";
import {
  canManageClient,
  createDeveloperClient,
  deactivateDeveloperClient,
  findVisibleClientForUser,
  listVisibleClientsForUser,
  rotateDeveloperClientSecret,
  updateDeveloperClient,
} from "../modules/clients/index.js";
import { db } from "../lib/db.js";
import { logAuditEvent } from "../modules/audit/index.js";

function serializeClient(client: {
  id: string;
  clientId: string;
  clientName: string;
  description: string | null;
  clientType: string;
  redirectUris: unknown;
  postLogoutRedirectUris: unknown;
  allowedScopes: unknown;
  requiresPkce: boolean;
  tokenAuthMethod: string;
  isFirstParty: boolean;
  isActive: boolean;
  ownerUserId: string | null;
  ownerOrganizationId: string | null;
  ownerOrganization?: { id: string; name: string; slug: string } | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: client.id,
    client_id: client.clientId,
    client_name: client.clientName,
    description: client.description,
    client_type: client.clientType,
    redirect_uris: client.redirectUris as string[],
    post_logout_redirect_uris: client.postLogoutRedirectUris as string[],
    allowed_scopes: client.allowedScopes as string[],
    requires_pkce: client.requiresPkce,
    token_auth_method: client.tokenAuthMethod,
    is_first_party: client.isFirstParty,
    is_active: client.isActive,
    owner_user_id: client.ownerUserId,
    owner_org_id: client.ownerOrganizationId,
    owner_organization: client.ownerOrganization
      ? {
          id: client.ownerOrganization.id,
          name: client.ownerOrganization.name,
          slug: client.ownerOrganization.slug,
        }
      : null,
    created_at: client.createdAt.toISOString(),
    updated_at: client.updatedAt.toISOString(),
  };
}

export async function clientRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireSession);

  app.get("/v1/clients", async (request, reply) => {
    const user = request.authUser!;
    const { clients } = await listVisibleClientsForUser(user.id);

    return reply.code(200).send({
      clients: clients.map(serializeClient),
    });
  });

  app.post("/v1/clients", async (request, reply) => {
    const user = request.authUser!;
    const body = createOAuthClientSchema.parse(request.body);
    const ip = getClientIp(request);
    const userAgent = request.headers["user-agent"];

    if (body.owner_org_id) {
      const membership = await db.organizationMember.findFirst({
        where: {
          organizationId: body.owner_org_id,
          userId: user.id,
          status: "ACTIVE",
          role: { in: ["OWNER", "ADMIN"] },
        },
      });

      if (!membership) {
        return reply.code(403).send({
          error: {
            code: "forbidden",
            message: "You are not allowed to create OAuth clients for that organization.",
          },
        });
      }
    }

    const created = await createDeveloperClient({
      clientName: body.client_name,
      description: body.description,
      clientType: body.client_type,
      redirectUris: body.redirect_uris,
      postLogoutRedirectUris: body.post_logout_redirect_uris,
      allowedScopes: body.allowed_scopes,
      requiresPkce: body.requires_pkce,
      tokenAuthMethod: body.token_auth_method,
      ownerUserId: body.owner_org_id ? null : user.id,
      ownerOrganizationId: body.owner_org_id ?? null,
    });

    await logAuditEvent({
      actorUserId: user.id,
      clientId: created.client.clientId,
      eventType: "OAUTH_CLIENT_CREATED",
      eventData: {
        owner_scope: body.owner_org_id ? "organization" : "user",
        owner_org_id: body.owner_org_id ?? null,
      },
      ipAddress: ip,
      userAgent,
    });

    return reply.code(201).send({
      client: serializeClient(created.client),
      client_secret: created.clientSecret ?? null,
    });
  });

  app.get("/v1/clients/:clientId", async (request, reply) => {
    const user = request.authUser!;
    const { clientId } = oauthClientIdSchema.parse(request.params);
    const { client } = await findVisibleClientForUser(user.id, clientId);

    if (!client) {
      return reply.code(404).send({ error: { code: "not_found", message: "OAuth client not found." } });
    }

    return reply.code(200).send({ client: serializeClient(client) });
  });

  app.patch("/v1/clients/:clientId", async (request, reply) => {
    const user = request.authUser!;
    const { clientId } = oauthClientIdSchema.parse(request.params);
    const body = updateOAuthClientSchema.parse(request.body);
    const ip = getClientIp(request);
    const userAgent = request.headers["user-agent"];
    const { client, memberships } = await findVisibleClientForUser(user.id, clientId);

    if (!client) {
      return reply.code(404).send({ error: { code: "not_found", message: "OAuth client not found." } });
    }

    if (!canManageClient(client, user.id, memberships)) {
      return reply.code(403).send({ error: { code: "forbidden", message: "You cannot manage this OAuth client." } });
    }

    const updated = await updateDeveloperClient(clientId, {
      clientName: body.client_name,
      description: body.description === undefined ? undefined : body.description ?? undefined,
      redirectUris: body.redirect_uris,
      postLogoutRedirectUris: body.post_logout_redirect_uris,
      allowedScopes: body.allowed_scopes,
      requiresPkce: body.requires_pkce,
      isActive: body.is_active,
    });

    await logAuditEvent({
      actorUserId: user.id,
      clientId,
      eventType: "OAUTH_CLIENT_UPDATED",
      ipAddress: ip,
      userAgent,
    });

    return reply.code(200).send({ client: serializeClient(updated) });
  });

  app.post("/v1/clients/:clientId/rotate-secret", async (request, reply) => {
    const user = request.authUser!;
    const { clientId } = oauthClientIdSchema.parse(request.params);
    const ip = getClientIp(request);
    const userAgent = request.headers["user-agent"];
    const { client, memberships } = await findVisibleClientForUser(user.id, clientId);

    if (!client) {
      return reply.code(404).send({ error: { code: "not_found", message: "OAuth client not found." } });
    }

    if (!canManageClient(client, user.id, memberships)) {
      return reply.code(403).send({ error: { code: "forbidden", message: "You cannot manage this OAuth client." } });
    }

    const rotated = await rotateDeveloperClientSecret(clientId);

    await logAuditEvent({
      actorUserId: user.id,
      clientId,
      eventType: "OAUTH_CLIENT_SECRET_ROTATED",
      ipAddress: ip,
      userAgent,
    });

    return reply.code(200).send({
      client: serializeClient(rotated.client),
      client_secret: rotated.clientSecret,
    });
  });

  app.delete("/v1/clients/:clientId", async (request, reply) => {
    const user = request.authUser!;
    const { clientId } = oauthClientIdSchema.parse(request.params);
    const ip = getClientIp(request);
    const userAgent = request.headers["user-agent"];
    const { client, memberships } = await findVisibleClientForUser(user.id, clientId);

    if (!client) {
      return reply.code(404).send({ error: { code: "not_found", message: "OAuth client not found." } });
    }

    if (!canManageClient(client, user.id, memberships)) {
      return reply.code(403).send({ error: { code: "forbidden", message: "You cannot manage this OAuth client." } });
    }

    await deactivateDeveloperClient(clientId);

    await logAuditEvent({
      actorUserId: user.id,
      clientId,
      eventType: "OAUTH_CLIENT_DEACTIVATED",
      ipAddress: ip,
      userAgent,
    });

    return reply.code(200).send({ deactivated: true });
  });
}