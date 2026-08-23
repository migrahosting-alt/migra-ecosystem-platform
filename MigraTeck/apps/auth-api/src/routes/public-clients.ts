import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { db } from "../lib/db.js";

/**
 * Public-safe OAuth client branding handler (shared by both routes).
 * Returns ONLY display-safe branding for ACTIVE clients (whitelist-serialized).
 * Never returns secrets, redirect/logout URIs, scopes, owners, or internal flags.
 */
async function brandingHandler(request: FastifyRequest, reply: FastifyReply) {
  const { clientId } = request.params as { clientId: string };

  const client = await db.oAuthClient.findUnique({
    where: { clientId },
    select: {
      clientId: true,
      clientName: true,
      isActive: true,
      branding: true,
      defaultPostLoginUrl: true,
      supportUrl: true,
    },
  });

  if (!client || !client.isActive) {
    return reply
      .code(404)
      .send({ error: { code: "unknown_client", message: "Unknown client." } });
  }

  const b = (client.branding ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.length > 0 ? v : null;
  const bool = (v: unknown): boolean => v === true;

  return reply.code(200).send({
    client_id: client.clientId,
    display_name: str(b.display_name) ?? client.clientName,
    product_name: str(b.product_name) ?? client.clientName,
    logo_url: str(b.logo_url),
    monogram: str(b.monogram),
    primary_color: str(b.primary_color),
    accent_color: str(b.accent_color),
    gradient_start: str(b.gradient_start),
    gradient_end: str(b.gradient_end),
    background_style: str(b.background_style),
    eyebrow: str(b.eyebrow),
    headline: str(b.headline),
    support_copy: str(b.support_copy),
    security_label: str(b.security_label),
    supports_phone_auth: bool(b.supports_phone_auth),
    support_url: str(client.supportUrl) ?? str(b.support_url),
    footer_copy: str(b.footer_copy),
    default_post_login_url: str(client.defaultPostLoginUrl),
  });
}

/**
 * GET /clients/:clientId/branding      (internal-reachable)
 * GET /v1/clients/:clientId/branding   (public-edge-reachable; /v1/* routes to auth-api)
 * Both return the identical whitelist-serialized payload.
 */
export async function publicClientRoutes(app: FastifyInstance) {
  app.get("/clients/:clientId/branding", brandingHandler);
  app.get("/v1/clients/:clientId/branding", brandingHandler);
}
