/**
 * MigraAuth API — Fastify server entry point.
 * Centralized identity platform for the MigraTeck ecosystem.
 */
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyFormbody from "@fastify/formbody";
import { config } from "./config/env.js";

// Routes
import { authRoutes } from "./routes/auth.js";
import { oauthRoutes } from "./routes/oauth.js";
import { mfaRoutes } from "./routes/mfa.js";
import { sessionRoutes } from "./routes/sessions.js";
import { adminRoutes } from "./routes/admin.js";
import { organizationRoutes } from "./routes/organizations.js";

async function main() {
  const app = Fastify({
    logger: {
      level: config.isDev ? "info" : "warn",
      transport: config.isDev ? { target: "pino-pretty" } : undefined,
    },
    trustProxy: true,
  });

  // ── Plugins ─────────────────────────────────────────────────────

  await app.register(fastifyCookie);
  await app.register(fastifyFormbody);

  await app.register(fastifyCors, {
    origin: config.corsOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
  });

  await app.register(fastifyRateLimit, {
    max: config.globalRateLimit,
    timeWindow: "1 minute",
  });

  // ── Global error handler ──────────────────────────────────────────

  app.setErrorHandler((err: unknown, _request, reply) => {
    const error = err as Record<string, unknown>;
    // Zod validation errors
    if ((error as any).name === "ZodError" || (error as any).issues) {
      return reply.code(400).send({
        error: {
          code: "validation_error",
          message: "Invalid request data.",
          details: (error as any).issues ?? (error as any).message,
        },
      });
    }

    // Rate limit
    if ((error as any).statusCode === 429) {
      return reply.code(429).send({
        error: { code: "rate_limited", message: "Too many requests. Please slow down." },
      });
    }

    // Log unexpected errors
    app.log.error(err);
    return reply.code((error as any).statusCode ?? 500).send({
      error: {
        code: "internal_error",
        message: config.isDev ? String((error as any).message ?? err) : "An unexpected error occurred.",
      },
    });
  });

  // ── Routes ────────────────────────────────────────────────────────

  await app.register(authRoutes);
  await app.register(oauthRoutes);
  await app.register(mfaRoutes);
  await app.register(sessionRoutes);
  await app.register(adminRoutes);
  await app.register(organizationRoutes);

  // Health check
  app.get("/health", async () => ({ status: "ok", service: "migraauth-api" }));

  // ── Start ─────────────────────────────────────────────────────────

  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    `MigraAuth API listening on ${config.host}:${config.port} (${config.nodeEnv})`,
  );
}

main().catch((err) => {
  console.error("Failed to start MigraAuth API:", err);
  process.exit(1);
});
