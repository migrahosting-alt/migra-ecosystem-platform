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
