/**
 * Session authentication middleware for Fastify.
 * Validates the auth session cookie and attaches user context.
 */
import type { FastifyRequest, FastifyReply } from "fastify";
import { validateSession, validatePendingSession } from "../modules/sessions/index.js";
import { findUserById } from "../modules/users/index.js";
import { config } from "../config/env.js";
import { verifyAccessToken } from "../lib/jwt.js";
import { logAuditEvent } from "../modules/audit/index.js";
import { authorityForUser } from "../modules/authorization/platformRoles.js";
import type { PlatformAuthority, PlatformPermission } from "../modules/authorization/platformRoles.js";
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
    /**
     * True when the session answered for is MFA-pending. Set only by
     * `requireMfaChallengeOrUser`; every other guard refuses such sessions
     * outright, so elsewhere this is always absent.
     */
    mfaPending?: boolean;
    /** Resolved platform authority, set by `requirePermission`. */
    platformAuthority?: PlatformAuthority;
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

export async function authenticateWithBearerTokenPublic(request: FastifyRequest): Promise<User | null> {
  return authenticateWithBearerToken(request);
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
 * Platform-operator authorization.
 *
 * WHAT THIS REPLACES, IN TWO STEPS. `/v1/admin/*` was first guarded by
 * `requireAuthenticatedUser` alone — "is signed in" — so every signed-in
 * consumer could enumerate every user, read the whole audit log and disable ANY
 * account. That was closed with `AUTH_ADMIN_USER_IDS`, an env allowlist, chosen
 * deliberately because a role needs a schema and an interface and that is not
 * something to improvise while a hole is open. This is the end state that
 * comment promised: grants in the database, with a granter and a timestamp.
 *
 * DENY BY DEFAULT SURVIVES BOTH REWRITES. No grant and no bootstrap entry
 * authorizes nothing. The failure mode of a misconfigured deployment must be
 * "no one is an operator", never "everyone is" — which is precisely how this
 * surface came to be open.
 */
/**
 * Authorize by PERMISSION, never by role.
 *
 * Routes name the authority they need — `platform.users.suspend` — and this
 * resolves whether the caller has it. A guard that checked `role === "owner"`
 * would spread the role taxonomy across every handler, so re-cutting the
 * bundles later would mean auditing every route to find the ones that quietly
 * disagree. One definition, in `modules/authorization/platformRoles.ts`.
 */
export function requirePermission(permission: PlatformPermission) {
  const guard = async function guard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await requireAuthenticatedUser(request, reply);
    if (reply.sent) return;

    const user = request.authUser;
    if (!user) return;

    const authority = await authorityForUser(user.id);
    request.platformAuthority = authority;

    if (!authority.permissions.has(permission)) {
      /*
       * 404, not 403. A 403 confirms the endpoint exists and that the caller is
       * merely not permitted, which maps the operator surface for anyone
       * probing it. Nothing here needs to be discoverable by a non-operator.
       */
      await logAuditEvent({
        actorUserId: user.id,
        eventType: "ADMIN_ACCESS_DENIED",
        eventData: {
          path: String(request.url).split("?")[0] ?? "",
          required: permission,
          held_roles: authority.roles.join(",") || "none",
        },
        ipAddress: getClientIp(request),
        userAgent: request.headers["user-agent"],
      });
      reply.code(404).send({ error: { code: "not_found", message: "Not found." } });
      return;
    }

    /*
     * BOOTSTRAP USE IS RECORDED EVERY TIME. The env allowlist still authorizes
     * when a user holds no grants, because a fresh deployment has nobody who
     * can create the first grant. Auditing each use is what stops that
     * temporary path from quietly becoming permanent: the timeline shows
     * exactly how long the platform ran on an env var.
     */
    if (authority.viaBootstrap) {
      await logAuditEvent({
        actorUserId: user.id,
        eventType: "ADMIN_BOOTSTRAP_AUTHORITY_USED",
        eventData: {
          path: String(request.url).split("?")[0] ?? "",
          permission,
          hint: "grant this user a real OWNER role, then unset AUTH_ADMIN_USER_IDS",
        },
        ipAddress: getClientIp(request),
        userAgent: request.headers["user-agent"],
      });
    }
  };

  /*
   * TAGGED SO A RELEASE GATE CAN READ THE ROUTE TABLE, NOT THE SOURCE TEXT.
   *
   * A grep for `app.post("` missed `app.post<{ Params: … }>("` and would have
   * shipped the MFA-reset route unguarded. Fastify knows exactly which
   * preHandlers each route carries; marking the guard lets that registry be
   * inspected directly, so a route is provably authorized rather than
   * apparently so.
   */
  (guard as GuardWithPermission).platformPermission = permission;
  return guard;
}

/** A `requirePermission` guard, identifiable in a registered route's handlers. */
export type GuardWithPermission = ((
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<void>) & { platformPermission?: PlatformPermission };

/** The permission a preHandler enforces, or null if it is not one of ours. */
export function permissionOfGuard(handler: unknown): PlatformPermission | null {
  return (handler as GuardWithPermission | undefined)?.platformPermission ?? null;
}

/**
 * The ONE guard that admits an MFA-pending session.
 *
 * Used only by the endpoint that answers the challenge. Everything else goes
 * through `requireAuthenticatedUser`, which refuses pending sessions because
 * `validateSession` does.
 *
 * It also admits a FULLY authenticated user, because the same endpoint serves
 * two different jobs: answering a login challenge, and confirming a new
 * enrolment while already signed in. `request.mfaPending` tells them apart, and
 * the route promotes the session only in the first case.
 */
export async function requireMfaChallengeOrUser(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const sessionSecret = (request as RequestWithCookies).cookies[config.sessionCookieName];

  if (sessionSecret) {
    const result = await validatePendingSession(sessionSecret);
    if (result) {
      const user = await findUserById(result.session.userId);
      if (user && user.status !== "DISABLED") {
        request.authSession = result.session;
        request.authUser = user;
        request.mfaPending = result.mfaPending;
        return;
      }
    }
  }

  // A bearer token is never MFA-pending: tokens are only minted for sessions
  // that completed authentication.
  const bearerUser = await authenticateWithBearerTokenPublic(request);
  if (bearerUser) {
    request.mfaPending = false;
    return;
  }

  reply.code(401).send({ error: "unauthorized", message: "Authentication required" });
}
