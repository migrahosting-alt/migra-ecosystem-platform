import Fastify, { type FastifyInstance } from "fastify";
import { hasValidCsrfToken, requiresCsrf } from "./lib/csrf.js";
import { enforceRateLimit } from "./lib/rate-limit.js";
import { registerV1Routes } from "./routes/v1/index.js";
import { getDb } from "./lib/db.js";

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
    const key = request.ip ?? "unknown";
    const { allowed, resetAt } = enforceRateLimit({
      key,
      limit: 120,
      windowMs: 60_000,
    });

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
    } catch {
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
