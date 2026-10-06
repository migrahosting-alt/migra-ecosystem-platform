import type { FastifyRequest } from "fastify";
import { validateApiKey } from "./api-keys.js";

export type ApiKeyPrincipal = {
  id: string;
  orgId: string;
  name: string;
  publicKeyId: string;
  scopes: string[];
};

declare module "fastify" {
  interface FastifyRequest {
    apiKeyPrincipal?: ApiKeyPrincipal;
    apiUsageEventId?: string;
    apiRequestStartedAt?: number;
  }
}

function extractApiKey(request: FastifyRequest): string | null {
  const explicit = request.headers["x-api-key"];
  if (typeof explicit === "string" && explicit.trim()) {
    return explicit.trim();
  }

  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice("Bearer ".length).trim();
  return token.startsWith("mk_live_") ? token : null;
}

export async function attachApiKeyPrincipal(
  request: FastifyRequest,
): Promise<ApiKeyPrincipal | null> {
  const rawKey = extractApiKey(request);
  if (!rawKey) return null;

  const principal = await validateApiKey(rawKey);
  if (!principal) {
    throw Object.assign(new Error("API key is invalid, expired, or revoked"), {
      statusCode: 401,
    });
  }

  request.apiKeyPrincipal = principal;
  return principal;
}

export function requireApiKeyScope(
  request: FastifyRequest,
  requiredScope: string,
): ApiKeyPrincipal {
  const principal = request.apiKeyPrincipal;
  if (!principal) {
    throw Object.assign(new Error("A valid MigraTeck API key is required"), {
      statusCode: 401,
    });
  }

  if (!principal.scopes.includes(requiredScope)) {
    throw Object.assign(
      new Error("API key is missing required scope: " + requiredScope),
      { statusCode: 403 },
    );
  }

  return principal;
}
