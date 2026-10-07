import Fastify, { type FastifyInstance } from "fastify";
import { hasValidCsrfToken, requiresCsrf } from "./lib/csrf.js";
import { enforceRateLimit } from "./lib/rate-limit.js";
import { registerV1Routes } from "./routes/v1/index.js";
import { getDb } from "./lib/db.js";
import { attachApiKeyPrincipal } from "./lib/machine-auth.js";
import { recordApiRequestUsage } from "./lib/api-usage.js";

function logError(message: string, extra?: Record<string, unknown>): void {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      scope: "api",
      level: "error",
      message,
      ...extra,
    }),
  );
}

export async function buildApiApp(): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: true,
    logger: false,
    disableRequestLogging: true,
  });

  app.addHook("onRequest", async (request, reply) => {
    request.apiRequestStartedAt = Date.now();

    const principal = await attachApiKeyPrincipal(request);
    const rateLimit = principal
      ? Number(process.env.API_KEY_RATE_LIMIT_PER_MINUTE ?? 600)
      : Number(process.env.API_IP_RATE_LIMIT_PER_MINUTE ?? 120);
    const rateKey = principal
      ? "api-key:" + principal.id
      : "ip:" + (request.ip ?? "unknown");

    const { allowed, resetAt, remaining, limit } = enforceRateLimit({
      key: rateKey,
      limit: rateLimit,
      windowMs: 60_000,
    });

    reply.header("X-RateLimit-Limit", String(limit));
    reply.header("X-RateLimit-Remaining", String(remaining));
    reply.header("X-RateLimit-Reset", String(resetAt));
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");

    if (!allowed) {
      reply.code(429);
      throw new Error("Rate limit exceeded");
    }

    if (requiresCsrf(request) && !hasValidCsrfToken(request)) {
      reply.code(403);
      throw new Error("Missing or invalid CSRF token");
    }
  });

  app.addHook("onResponse", async (request, reply) => {
    if (!request.apiKeyPrincipal) return;
    try {
      await recordApiRequestUsage(request, reply.statusCode);
    } catch (error) {
      logError("api.usage_record_failed", {
        requestId: request.id,
        method: request.method,
        path: request.routeOptions?.url ?? request.url.split("?")[0],
        message: error instanceof Error ? error.message : "Unknown usage recording error",
      });
    }
  });

  app.get("/health", async () => ({
    service: "migrateck-platform-api",
    status: "ok",
    version: "0.1.0",
  }));

  app.get("/ready", async (_request, reply) => {
    try {
      await getDb().query("SELECT 1");
      const authUrl = (
        process.env.MIGRAAUTH_API_URL ??
        process.env.MIGRAAUTH_BASE_URL ??
        "http://127.0.0.1:4120"
      ).replace(/\/+$/, "");
      const auth = await fetch(authUrl + "/health", {
        signal: AbortSignal.timeout(3_000),
      });
      if (!auth.ok) {
        throw new Error("MigraAuth dependency is not ready");
      }

      return {
        service: "migrateck-platform-api",
        status: "ready",
        dependencies: {
          database: "ready",
          migraauth: "ready",
        },
      };
    } catch (error) {
      logError("api.readiness_failed", {
        message:
          error instanceof Error
            ? error.message
            : "Unknown readiness dependency failure",
      });

      return reply.code(503).send({
        service: "migrateck-platform-api",
        status: "not_ready",
      });
    }
  });

  await registerV1Routes(app);

  app.setErrorHandler((error, request, reply) => {
    const message = error instanceof Error ? error.message : "Unknown error";

    logError("api.request_failed", {
      method: request.method,
      path: request.url,
      message,
    });

    reply.code(reply.statusCode >= 400 ? reply.statusCode : 500).send({
      error: "request_failed",
      message,
    });
  });

  return app;
}
