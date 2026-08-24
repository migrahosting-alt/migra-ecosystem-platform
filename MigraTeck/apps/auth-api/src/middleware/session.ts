/**
 * Session authentication middleware for Fastify.
 * Validates the auth session cookie and attaches user context.
 */
import type { FastifyRequest, FastifyReply } from "fastify";
import { validateSession } from "../modules/sessions/index.js";
import { findUserById } from "../modules/users/index.js";
import { config } from "../config/env.js";
import { verifyAccessToken } from "../lib/jwt.js";
import { logAuditEvent } from "../modules/audit/index.js";
import type { User, Session } from "../prisma-client.js";

declare module "fastify" {
  interface FastifyRequest {
    authSession?: Session;
    authUser?: User;
    /**
     * Which first-party app is making this request, taken from the SIGNED access
     * token's `client_id`.
     *
     * TRUSTED BECAUSE IT IS INSIDE THE JWT. A header or body field naming the
     * product would be caller-supplied, and anything deriving branding from it
     * would let a caller choose how MigraAuth presents itself. This is set only
     * on the bearer path — a cookie session is MigraAuth's own web UI, which has
     * no OAuth client and correctly gets the default branding.
     */
    authClientId?: string;
  }
}

type RequestWithCookies = FastifyRequest & {
  cookies: Record<string, string | undefined>;
};

/**
 * Require a valid auth session cookie.
 * Attaches `request.authSession` and `request.authUser`.
 */
export async function requireSession(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const sessionSecret = (request as RequestWithCookies).cookies[config.sessionCookieName];
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

function getBearerToken(authorization?: string): string | null {
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice("Bearer ".length).trim();
  return token || null;
}

async function authenticateWithBearerToken(request: FastifyRequest): Promise<User | null> {
  const token = getBearerToken(request.headers.authorization);
  if (!token) {
    return null;
  }

  try {
    const payload = await verifyAccessToken(token);
    const user = await findUserById(payload.sub);

    if (!user || user.status === "DISABLED") {
      return null;
    }

    request.authUser = user;
    // Recorded so product-aware behaviour (currently MFA issuer branding) can
    // ask which app the token was issued to, without ever trusting the caller
    // to say.
    request.authClientId = payload.client_id;
    return user;
  } catch {
    return null;
  }
}

export async function requireAuthenticatedUser(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const sessionSecret = (request as RequestWithCookies).cookies[config.sessionCookieName];

  if (sessionSecret) {
    const session = await validateSession(sessionSecret);
    if (session) {
      const user = await findUserById(session.userId);
      if (user && user.status !== "DISABLED") {
        request.authSession = session;
        request.authUser = user;
        return;
      }
    }
  }

  const bearerUser = await authenticateWithBearerToken(request);
  if (bearerUser) {
    return;
  }

  reply.code(401).send({ error: "unauthorized", message: "Authentication required" });
}

/**
 * Optional session — attaches user if cookie is present, but doesn't block.
 */
export async function optionalSession(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const sessionSecret = (request as RequestWithCookies).cookies[config.sessionCookieName];
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

/**
 * Admin authorization.
 *
 * WHAT THIS REPLACES. `/v1/admin/*` was guarded by `requireAuthenticatedUser`
 * alone — "is signed in", nothing more. There is no admin role on the User
 * model, so there was no check to make: every signed-in MigraPilot consumer
 * could enumerate every user, read the entire audit log, read OAuth client
 * configuration, and disable, lock or unlock ANY account. The source said so
 * twice, in comments, and shipped anyway.
 *
 * DENY BY DEFAULT. An unset or empty allowlist authorizes nobody. The failure
 * mode of a misconfigured deployment must be "no one is an operator", never
 * "everyone is" — which is precisely how this surface came to be open.
 *
 * AN ALLOWLIST, NOT A ROLE, DELIBERATELY — for now. A role belongs in the
 * schema with a migration and an interface to manage it; that is the right
 * end state and it is not something to improvise while closing a live hole.
 * This is deployable immediately, has no schema dependency, and is strictly
 * narrower than what it replaces.
 */
function adminUserIds(): Set<string> {
  return new Set(
    (process.env["AUTH_ADMIN_USER_IDS"] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
}

export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await requireAuthenticatedUser(request, reply);
  if (reply.sent) return;

  const user = request.authUser;
  const allowed = adminUserIds();

  if (!user || !allowed.has(user.id)) {
    /*
     * 404, not 403. A 403 confirms the endpoint exists and that the caller is
     * simply not permitted, which maps the operator surface for anyone probing
     * it. Nothing here needs to be discoverable by a non-operator.
     */
    await logAuditEvent({
      actorUserId: user?.id,
      eventType: "ADMIN_ACCESS_DENIED",
      eventData: { path: String(request.url).split("?")[0] ?? "" },
      ipAddress: getClientIp(request),
      userAgent: request.headers["user-agent"],
    });
    reply.code(404).send({ error: { code: "not_found", message: "Not found." } });
  }
}
