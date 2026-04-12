/**
 * Session authentication middleware for Fastify.
 * Validates the auth session cookie and attaches user context.
 */
import type { FastifyRequest, FastifyReply } from "fastify";
import { validateSession } from "../modules/sessions/index.js";
import { findUserById } from "../modules/users/index.js";
import { config } from "../config/env.js";
import type { User, Session } from ".prisma/auth-client";

declare module "fastify" {
  interface FastifyRequest {
    authSession?: Session;
    authUser?: User;
  }
}

/**
 * Require a valid auth session cookie.
 * Attaches `request.authSession` and `request.authUser`.
 */
export async function requireSession(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const sessionSecret = request.cookies[config.sessionCookieName];
  if (!sessionSecret) {
    reply.code(401).send({ error: "unauthorized", message: "No session cookie" });
    return;
  }

  const session = await validateSession(sessionSecret);
  if (!session) {
    reply.code(401).send({ error: "unauthorized", message: "Invalid or expired session" });
    return;
  }

  const user = await findUserById(session.userId);
  if (!user || user.status === "DISABLED") {
    reply.code(401).send({ error: "unauthorized", message: "Account unavailable" });
    return;
  }

  request.authSession = session;
  request.authUser = user;
}

/**
 * Optional session — attaches user if cookie is present, but doesn't block.
 */
export async function optionalSession(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const sessionSecret = request.cookies[config.sessionCookieName];
  if (!sessionSecret) return;

  const session = await validateSession(sessionSecret);
  if (!session) return;

  const user = await findUserById(session.userId);
  if (!user || user.status === "DISABLED") return;

  request.authSession = session;
  request.authUser = user;
}

/**
 * Helper to get client IP from request (behind proxy).
 */
export function getClientIp(request: FastifyRequest): string | undefined {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0]?.trim();
  return request.ip;
}
