import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyRequest } from "fastify";
import { sanitizeApiRoute } from "./api-usage.js";
import { requireApiKeyScope } from "./machine-auth.js";
import { enforceRateLimit } from "./rate-limit.js";

function fakeRequest(input: Partial<FastifyRequest>): FastifyRequest {
  return input as FastifyRequest;
}

test("machine scope enforcement accepts only the required API-key scope", () => {
  const request = fakeRequest({
    apiKeyPrincipal: {
      id: "key_1",
      orgId: "org_1",
      name: "CI",
      publicKeyId: "pub_1",
      scopes: ["products:read"],
    },
  });

  const principal = requireApiKeyScope(request, "products:read");
  assert.equal(principal.id, "key_1");

  assert.throws(
    () => requireApiKeyScope(request, "billing:write"),
    (error: unknown) =>
      error instanceof Error
      && (error as Error & { statusCode?: number }).statusCode === 403,
  );
});

test("machine scope enforcement rejects requests without an API-key principal", () => {
  const request = fakeRequest({});
  assert.throws(
    () => requireApiKeyScope(request, "products:read"),
    (error: unknown) =>
      error instanceof Error
      && (error as Error & { statusCode?: number }).statusCode === 401,
  );
});

test("rate-limit buckets return limit and remaining capacity independently", () => {
  const first = enforceRateLimit({ key: "contract:key-a", limit: 2, windowMs: 60_000 });
  const second = enforceRateLimit({ key: "contract:key-a", limit: 2, windowMs: 60_000 });
  const third = enforceRateLimit({ key: "contract:key-a", limit: 2, windowMs: 60_000 });
  const other = enforceRateLimit({ key: "contract:key-b", limit: 2, windowMs: 60_000 });

  assert.deepEqual(
    { allowed: first.allowed, remaining: first.remaining, limit: first.limit },
    { allowed: true, remaining: 1, limit: 2 },
  );
  assert.deepEqual(
    { allowed: second.allowed, remaining: second.remaining },
    { allowed: true, remaining: 0 },
  );
  assert.deepEqual(
    { allowed: third.allowed, remaining: third.remaining },
    { allowed: false, remaining: 0 },
  );
  assert.equal(other.allowed, true);
  assert.equal(other.remaining, 1);
});

test("telemetry prefers registered route patterns over raw URLs", () => {
  const request = fakeRequest({
    url: "/v1/items/secret-id?token=do-not-store",
    routeOptions: { url: "/v1/items/:itemId" } as FastifyRequest["routeOptions"],
  });

  assert.equal(sanitizeApiRoute(request), "/v1/items/:itemId");
});

test("telemetry fallback strips query strings", () => {
  const request = fakeRequest({
    url: "/v1/products?api_key=do-not-store&customer=sensitive",
    routeOptions: {} as FastifyRequest["routeOptions"],
  });

  assert.equal(sanitizeApiRoute(request), "/v1/products");
});
