import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import { config } from "./config/env.js";
import { registerV1Routes } from "./routes/v1/index.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: true,
    logger: false,
    disableRequestLogging: true,
  });

  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  });

  await app.register(formbody);

  // Security headers
  app.addHook("onSend", async (_request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "SAMEORIGIN");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
  });

  app.get("/health", async () => ({
    ok: true,
    service: "migrabuilder-api",
    version: "0.1.0",
  }));

  await registerV1Routes(app);

  app.setErrorHandler((error, request, reply) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = reply.statusCode >= 400 ? reply.statusCode : 500;

    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        method: request.method,
        url: request.url,
        message,
        status,
      }),
    );

    reply.code(status).send({ error: "request_failed", message });
  });

  return app;
}
