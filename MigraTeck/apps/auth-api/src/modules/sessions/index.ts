/**
 * Sessions module — central auth sessions (cookie-backed, server-side).
 */
import { db } from "../../lib/db.js";
import { generateToken, hashToken } from "../../lib/crypto.js";
import { config } from "../../config/env.js";
import type { Session } from "../../prisma-client.js";

export type { Session };

export interface SessionCreateResult {
  session: Session;
  /** Raw session secret — set this in the cookie, never store raw. */
  sessionSecret: string;
}

export async function createAuthSession(
  userId: string,
  ipAddress?: string,
  userAgent?: string,
  /**
   * Create the session as MFA-PENDING.
   *
   * Passed by the login paths when the account has a second factor: the browser
   * needs an identity to answer the challenge with, and must have nothing more
   * until it does. `validateSession` refuses pending sessions, so this flag is
   * the whole enforcement — no route has to remember to check it.
   */
  opts?: { mfaPending?: boolean },
): Promise<SessionCreateResult> {
  const sessionSecret = generateToken(32);
  const sessionSecretHash = hashToken(sessionSecret);
  const expiresAt = new Date(Date.now() + config.sessionTtl * 1000);

  const session = await db.session.create({
    data: {
      userId,
      sessionType: "AUTH",
      sessionSecretHash,
      expiresAt,
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
      mfaPendingAt: opts?.mfaPending ? new Date() : null,
    },
  });

  return { session, sessionSecret };
}

export async function getSessionById(sessionId: string): Promise<Session | null> {
  return db.session.findUnique({ where: { id: sessionId } });
}

export async function validateSession(
  sessionSecret: string,
): Promise<Session | null> {
  const sessionSecretHash = hashToken(sessionSecret);
  const session = await db.session.findFirst({
    where: {
      sessionSecretHash,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      /*
       * ── THE MFA BOUNDARY LIVES HERE, NOT IN THE ROUTES ─────────────
       *
       * A session created before second-factor verification is not an
       * authenticated session. Enforcing that in this one query means every
       * guard, every route, and every route written in future inherits the
       * refusal without knowing MFA exists.
       *
       * The alternative — checking in each handler — is how the hole existed in
       * the first place: `requireAuthenticatedUser` accepted the pre-challenge
       * cookie, so an unanswered challenge still authorised `/v1/me`,
       * `/v1/me/security` and `/v1/admin/*`. Measured on production.
       *
       * `validatePendingSession` is the single deliberate exception, used only
       * by the endpoint whose job is to answer the challenge.
       */
      mfaPendingAt: null,
    },
  });

  if (!session) return null;

  // Touch last-seen
  await db.session.update({
    where: { id: session.id },
    data: { lastSeenAt: new Date() },
  });

  return session;
}

export async function rotateAuthSession(
  sessionId: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<SessionCreateResult | null> {
  const current = await db.session.findFirst({
    where: {
      id: sessionId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
  });

  if (!current) {
    return null;
  }

  const sessionSecret = generateToken(32);
  const sessionSecretHash = hashToken(sessionSecret);
  const expiresAt = new Date(Date.now() + config.sessionTtl * 1000);

  const session = await db.session.update({
    where: { id: current.id },
    data: {
      sessionSecretHash,
      expiresAt,
      lastSeenAt: new Date(),
      ipAddress: ipAddress ?? current.ipAddress ?? null,
      userAgent: userAgent ?? current.userAgent ?? null,
    },
  });

  return { session, sessionSecret };
}

/**
 * Record which PRODUCT this browser session was established for.
 *
 * WHY THE SESSION AND NOT THE URL. Account-security surfaces — /account/password
 * and whatever follows it — are opened from a product's settings by a plain
 * link, so there is no authorization transaction to read and no `txn` in the
 * address. Branding from a `client_id` query parameter would mean anyone could
 * make MigraAuth wear any product's identity by editing a URL, which is exactly
 * the property the durable transaction was built to remove.
 *
 * So it is stamped from TRUSTED STATE at the only moments both facts are known
 * at once: when a transaction is consumed for an authenticated session. The
 * browser never supplies it and cannot alter it.
 *
 * Null stays null for a sign-in that was not completing any product's request —
 * signing in at MigraAuth directly — and that reads correctly as MigraAuth's own
 * branding rather than as missing data.
 *
 * The LATEST product wins. A session that later authorizes a second product is
 * genuinely in that product's context now, and the honest answer to "which
 * product is this person in" is the most recent one, not the first.
 */
export async function stampSessionClient(sessionId: string, clientId: string): Promise<void> {
  await db.session.updateMany({
    // Scoped to a live session on purpose: a revoked one must not be
    // resurrected into a product context it can no longer act in.
    where: { id: sessionId, revokedAt: null },
    data: { clientId },
  });
}

export async function revokeSession(sessionId: string): Promise<void> {
  await db.session.update({
    where: { id: sessionId },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllUserSessions(userId: string): Promise<number> {
  const result = await db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function revokeOtherUserSessions(
  userId: string,
  currentSessionId: string,
): Promise<number> {
  const result = await db.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      id: { not: currentSessionId },
    },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function listUserSessions(
  userId: string,
): Promise<Session[]> {
  return db.session.findMany({
    where: {
      userId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * A session that has proved WHO but not yet PRESENCE.
 *
 * Returned only by `validatePendingSession`. Nothing else in the service can
 * obtain one, which is the point: the ability to see a half-authenticated
 * session has to be opted into explicitly, at exactly one call site.
 */
export interface PendingSessionResult {
  session: Session;
  mfaPending: boolean;
}

/**
 * Validate a session for the MFA challenge, pending or not.
 *
 * THE ONLY DOOR A PENDING SESSION FITS. `validateSession` refuses them, so the
 * verify endpoint needs a way to identify the person answering a challenge —
 * and it is the one endpoint that legitimately does.
 *
 * It reports `mfaPending` rather than hiding it, because the caller behaves
 * differently: a pending session that verifies must be PROMOTED and given a
 * refresh token, while an already-authenticated user verifying is confirming an
 * enrolment and needs neither.
 */
export async function validatePendingSession(
  sessionSecret: string,
): Promise<PendingSessionResult | null> {
  const sessionSecretHash = hashToken(sessionSecret);
  const session = await db.session.findFirst({
    where: {
      sessionSecretHash,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (!session) return null;

  await db.session.update({
    where: { id: session.id },
    data: { lastSeenAt: new Date() },
  });

  return { session, mfaPending: session.mfaPendingAt !== null };
}

/**
 * Promote a session once the second factor is proved.
 *
 * CONDITIONAL, so it cannot be replayed into an already-promoted session and
 * cannot promote a session that was never pending. The row count is the
 * authority — a promotion that matched nothing did not happen, and the caller
 * must not treat it as success.
 */
export async function promoteSessionAfterMfa(sessionId: string): Promise<boolean> {
  const result = await db.session.updateMany({
    where: { id: sessionId, mfaPendingAt: { not: null }, revokedAt: null },
    data: { mfaPendingAt: null },
  });
  return result.count === 1;
}
