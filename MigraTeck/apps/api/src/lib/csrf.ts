import type { FastifyRequest } from "fastify";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function requiresCsrf(request: FastifyRequest): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) {
    return false;
  }

  // Bearer-authenticated API mutations are not ambient browser authority, so
  // they are not vulnerable to cookie-based CSRF. Browser/cookie mutations
  // still require the same-origin CSRF contract below.
  if (request.headers.authorization?.startsWith("Bearer ")) {
    return false;
  }

  const apiKey = request.headers["x-api-key"];
  if (typeof apiKey === "string" && apiKey.trim()) {
    return false;
  }

  // Tenant-native Intake forms intentionally accept anonymous public
  // submissions. They carry no cookie/bearer authority, so CSRF is not the
  // relevant control; form state, entitlement checks, schema validation, and
  // rate limiting are enforced by the route itself.
  const route = request.routeOptions?.url ?? request.url.split("?")[0] ?? "";
  if (route.startsWith("/v1/intake/public/")) {
    return false;
  }

  // Stripe webhooks carry no browser authority. They are authenticated by the
  // Stripe-Signature over the exact raw request body inside the route handler.
  if (
    route === "/v1/billing/webhooks/stripe" ||
    route === "/billing/webhooks/stripe"
  ) {
    return false;
  }

  return true;
}

export function hasValidCsrfToken(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  const host = request.headers.host;
  const token = request.headers["x-csrf-token"];

  if (!origin || !host || typeof token !== "string") {
    return false;
  }

  try {
    const originHost = new URL(origin).host;

    return originHost === host && token.length >= 24;
  } catch {
    return false;
  }
}
