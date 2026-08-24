/**
 * Auth routes — signup, verification, login, logout, email verification, password reset.
 * Response shapes align with the auth-web needs and the unified identifier model.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  signupSchema,
  signupVerifySchema,
  loginSchema,
  logoutSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  updateProfileSchema,
  requestEmailChangeSchema,
  confirmEmailChangeSchema,
  closeAccountSchema,
} from "../lib/schemas.js";
import {
  consumeEmailVerification,
  consumePasswordReset,
  consumeVerificationChallenge,
  createPasswordResetToken,
  createUser,
  createVerificationChallenge,
  findIdentifierByParsedValue,
  findUserById,
  findUserByIdentifier,
  getLatestVerificationChallengeForIdentifier,
  getVerificationChallenge,
  markEmailVerified,
  markIdentifierVerified,
  updateLastLogin,
  verifyUserPassword,
  changePassword,
  completeEmailChange,
  closeUserAccount,
} from "../modules/users/index.js";
import {
  createAuthSession,
  getSessionById,
  revokeSession,
  revokeAllUserSessions,
  rotateAuthSession,
} from "../modules/sessions/index.js";
import { hasTotpEnabled } from "../modules/mfa/index.js";
import { logAuditEvent } from "../modules/audit/index.js";
import { sendPasswordResetNotification, sendVerificationCode } from "../lib/notifications.js";
import { parseIdentifier, maskIdentifier } from "../lib/identifier.js";
import { db } from "../lib/db.js";
import { config } from "../config/env.js";
import { requireAuthenticatedUser, requireSession, getClientIp } from "../middleware/session.js";
import {
  findRefreshToken,
  issueFirstPartyRefreshToken,
  revokeRefreshTokenFamily,
  rotateFirstPartyRefreshToken,
} from "../modules/tokens/index.js";
import type { User, UserIdentifier } from "../prisma-client.js";

type RequestWithCookies = FastifyRequest & {
  cookies: Record<string, string | undefined>;
};

type ReplyWithCookies = FastifyReply & {
  setCookie: (
    name: string,
    value: string,
    options: Record<string, unknown>,
  ) => FastifyReply;
  clearCookie: (
    name: string,
    options?: Record<string, unknown>,
  ) => FastifyReply;
};

export function setSessionCookie(
  reply: FastifyReply,
  sessionSecret: string,
): void {
  (reply as ReplyWithCookies).setCookie(config.sessionCookieName, sessionSecret, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "lax",
    path: "/",
    domain: config.cookieDomain,
    maxAge: config.sessionTtl,
  });
}

function clearSessionCookie(reply: FastifyReply): void {
  (reply as ReplyWithCookies).clearCookie(config.sessionCookieName, {
    path: "/",
    domain: config.cookieDomain,
  });
}

export function setRefreshCookie(
  reply: FastifyReply,
  refreshToken: string,
): void {
  (reply as ReplyWithCookies).setCookie(config.refreshCookieName, refreshToken, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "lax",
    path: "/",
    domain: config.cookieDomain,
    maxAge: config.refreshTokenTtl,
  });
}

function clearRefreshCookie(reply: FastifyReply): void {
  (reply as ReplyWithCookies).clearCookie(config.refreshCookieName, {
    path: "/",
    domain: config.cookieDomain,
  });
}

function toPublicUser(user: User) {
  return {
    id: user.id,
    email: user.email ?? null,
    phone_e164: user.phoneE164 ?? null,
    status: user.status,
    email_verified: !!user.emailVerifiedAt,
    phone_verified: !!user.phoneVerifiedAt,
    display_name: user.displayName ?? undefined,
  };
}

function toSessionSummary(session: {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt?: Date | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  return {
    id: session.id,
    created_at: session.createdAt.toISOString(),
    expires_at: session.expiresAt.toISOString(),
    last_seen_at: session.lastSeenAt?.toISOString() ?? null,
    ip_address: session.ipAddress ?? null,
    user_agent: session.userAgent ?? null,
  };
}

function challengeFailureResponse(reason: "not_found" | "expired" | "max_attempts" | "invalid_code") {
  switch (reason) {
    case "expired":
      return { status: 400, body: { error: { code: "challenge_expired", message: "Verification code expired. Request a new one." } } };
    case "max_attempts":
      return { status: 429, body: { error: { code: "max_attempts", message: "Too many incorrect codes. Request a new one." } } };
    case "invalid_code":
      return { status: 400, body: { error: { code: "invalid_code", message: "Verification code is incorrect." } } };
    default:
      return { status: 400, body: { error: { code: "invalid_challenge", message: "Verification challenge is invalid." } } };
  }
}

function tryParseIdentifier(input: string) {
  try {
    return { ok: true as const, value: parseIdentifier(input) };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "Enter a valid email address or phone number.",
    };
  }
}

async function issueVerificationChallenge(input: {
  userId: string;
  identifier: UserIdentifier;
  ip?: string;
  userAgent?: string;
  kind: "SIGNUP_VERIFY" | "RESET_PASSWORD";
}) {
  const challenge = await createVerificationChallenge({
    userId: input.userId,
    identifierId: input.identifier.id,
    kind: input.kind,
    channel: input.identifier.kind === "EMAIL" ? "EMAIL" : "SMS",
    ipAddress: input.ip,
    userAgent: input.userAgent,
  });

  await sendVerificationCode({
    channel: input.identifier.kind === "EMAIL" ? "EMAIL" : "SMS",
    destination: input.identifier.normalizedValue,
    code: challenge.code,
  });

  return {
    challengeId: challenge.challenge.id,
    channel: input.identifier.kind === "EMAIL" ? "email" : "sms",
    maskedDestination: maskIdentifier({
      kind: input.identifier.kind,
      normalized: input.identifier.normalizedValue,
    }),
  };
}

export async function establishFirstPartySession(input: {
  reply: FastifyReply;
  userId: string;
  ip?: string;
  userAgent?: string;
}) {
  const { sessionSecret, session } = await createAuthSession(input.userId, input.ip, input.userAgent);
  const refreshToken = await issueFirstPartyRefreshToken({
    userId: input.userId,
    sessionId: session.id,
    ipAddress: input.ip,
    userAgent: input.userAgent,
  });

  setSessionCookie(input.reply, sessionSecret);
  setRefreshCookie(input.reply, refreshToken);

  return { session };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /v1/signup ───────────────────────────────────────────────
  app.post("/v1/signup", async (request, reply) => {
    const body = signupSchema.parse(request.body);
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];

    const parsedIdentifier = tryParseIdentifier(body.identifier);
    if (!parsedIdentifier.ok) {
      return reply.code(400).send({
        error: { code: "invalid_identifier", message: parsedIdentifier.message },
      });
    }
    const existingIdentifier = await findIdentifierByParsedValue(parsedIdentifier.value);
    if (existingIdentifier) {
      return reply.code(409).send({
        error: { code: "identifier_taken", message: "An account with this email or phone number already exists." },
      });
    }

    const created = await createUser(parsedIdentifier.value, body.password, body.display_name);
    const verification = await issueVerificationChallenge({
      userId: created.user.id,
      identifier: created.identifier,
      ip,
      userAgent: ua,
      kind: "SIGNUP_VERIFY",
    });

    await logAuditEvent({
      actorUserId: created.user.id,
      eventType: "SIGNUP",
      clientId: body.client_id,
      eventData: {
        identifier: created.identifier.normalizedValue,
        identifier_kind: created.identifier.kind.toLowerCase(),
      },
      ipAddress: ip,
      userAgent: ua,
    });

    return reply.code(201).send({
      user: toPublicUser(created.user),
      challenge_id: verification.challengeId,
      channel: verification.channel,
      masked_destination: verification.maskedDestination,
      expires_in_seconds: config.verificationCodeTtl,
      resend_after_seconds: config.verificationResendCooldownSec,
      message: "Account created. Verify your contact method to activate your session.",
    });
  });

  // ── POST /v1/signup/verify ────────────────────────────────────────
  app.post("/v1/signup/verify", async (request, reply) => {
    const body = signupVerifySchema.parse(request.body);
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];

    const result = await consumeVerificationChallenge({
      challengeId: body.challenge_id,
      code: body.code,
      expectedKind: "SIGNUP_VERIFY",
    });

    if (!result.ok) {
      const failure = challengeFailureResponse(result.reason);
      return reply.code(failure.status).send(failure.body);
    }

    if (!result.challenge.identifierId) {
      return reply.code(400).send({
        error: { code: "invalid_challenge", message: "Verification challenge is missing an identifier." },
      });
    }

    const verified = await markIdentifierVerified(result.challenge.identifierId);
    const { session } = await establishFirstPartySession({
      reply,
      userId: verified.user.id,
      ip,
      userAgent: ua,
    });
    await updateLastLogin(verified.user.id);

    await logAuditEvent({
      actorUserId: verified.user.id,
      eventType: "SIGNUP_VERIFIED",
      eventData: {
        identifier: verified.identifier.normalizedValue,
        identifier_kind: verified.identifier.kind.toLowerCase(),
      },
      ipAddress: ip,
      userAgent: ua,
    });

    return reply.code(200).send({
      authenticated: true,
      user: toPublicUser(verified.user),
      session: toSessionSummary(session),
    });
  });

  // ── POST /v1/login ────────────────────────────────────────────────
  app.post("/v1/login", async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];

    const parsedIdentifier = tryParseIdentifier(body.identifier);
    if (!parsedIdentifier.ok) {
      return reply.code(400).send({
        error: { code: "invalid_identifier", message: parsedIdentifier.message },
      });
    }
    const result = await findUserByIdentifier(parsedIdentifier.value);

    if (!result) {
      await logAuditEvent({
        eventType: "LOGIN_FAILURE",
        eventData: { identifier: parsedIdentifier.value.normalized, reason: "not_found" },
        ipAddress: ip,
        userAgent: ua,
      });
      return reply.code(401).send({
        error: { code: "invalid_credentials", message: "Invalid email, phone number, or password." },
      });
    }

    const { user, identifier } = result;

    if (user.status === "LOCKED") {
      return reply.code(403).send({
        error: { code: "account_locked", message: "Account is locked. Reset your password or try again later." },
      });
    }
    if (user.status === "DISABLED") {
      return reply.code(403).send({
        error: { code: "account_disabled", message: "Account has been disabled." },
      });
    }

    const valid = await verifyUserPassword(user, body.password);
    if (!valid) {
      await logAuditEvent({
        actorUserId: user.id,
        eventType: "LOGIN_FAILURE",
        eventData: { identifier: identifier.normalizedValue, reason: "wrong_password" },
        ipAddress: ip,
        userAgent: ua,
      });
      return reply.code(401).send({
        error: { code: "invalid_credentials", message: "Invalid email, phone number, or password." },
      });
    }

    if (!identifier.isVerified || user.status === "PENDING") {
      const verification = await issueVerificationChallenge({
        userId: user.id,
        identifier,
        ip,
        userAgent: ua,
        kind: "SIGNUP_VERIFY",
      });

      return reply.code(403).send({
        status: "verification_required",
        challenge_id: verification.challengeId,
        channel: verification.channel,
        masked_destination: verification.maskedDestination,
        message: "Verify your account before signing in.",
      });
    }

    const mfaRequired = await hasTotpEnabled(user.id);
    if (mfaRequired) {
      const { sessionSecret } = await createAuthSession(user.id, ip, ua);
      setSessionCookie(reply, sessionSecret);
      return reply.code(200).send({
        authenticated: false,
        requires_mfa: true,
      });
    }

    const { session } = await establishFirstPartySession({
      reply,
      userId: user.id,
      ip,
      userAgent: ua,
    });
    await updateLastLogin(user.id);

    await logAuditEvent({
      actorUserId: user.id,
      eventType: "LOGIN_SUCCESS",
      clientId: body.client_id,
      eventData: {
        identifier: identifier.normalizedValue,
        identifier_kind: identifier.kind.toLowerCase(),
      },
      ipAddress: ip,
      userAgent: ua,
    });

    return reply.code(200).send({
      authenticated: true,
      requires_mfa: false,
      user: toPublicUser(user),
      session: toSessionSummary(session),
    });
  });

  // ── POST /v1/refresh ──────────────────────────────────────────────
  app.post("/v1/refresh", async (request, reply) => {
    const refreshToken = (request as RequestWithCookies).cookies[config.refreshCookieName];
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];

    if (!refreshToken) {
      return reply.code(401).send({
        error: { code: "missing_refresh_token", message: "Refresh token is required." },
      });
    }

    const existing = await findRefreshToken(refreshToken, config.firstPartyRefreshClientId);
    if (!existing) {
      clearRefreshCookie(reply);
      clearSessionCookie(reply);
      await logAuditEvent({
        eventType: "REFRESH_FAILURE",
        eventData: { reason: "not_found" },
        ipAddress: ip,
        userAgent: ua,
      });
      return reply.code(401).send({
        error: { code: "invalid_refresh_token", message: "Refresh token is invalid or expired." },
      });
    }

    const sessionId = existing.deviceId ?? null;
    if (!sessionId) {
      await revokeRefreshTokenFamily(refreshToken);
      clearRefreshCookie(reply);
      clearSessionCookie(reply);
      await logAuditEvent({
        actorUserId: existing.userId,
        eventType: "REFRESH_FAILURE",
        eventData: { reason: "missing_session_binding" },
        ipAddress: ip,
        userAgent: ua,
      });
      return reply.code(401).send({
        error: { code: "invalid_refresh_token", message: "Refresh token is not bound to an active session." },
      });
    }

    if (existing.revokedAt || existing.rotatedAt) {
      await revokeRefreshTokenFamily(refreshToken);
      clearRefreshCookie(reply);
      clearSessionCookie(reply);
      await logAuditEvent({
        actorUserId: existing.userId,
        eventType: "REFRESH_FAILURE",
        eventData: { reason: "reuse_detected" },
        ipAddress: ip,
        userAgent: ua,
      });
      return reply.code(401).send({
        error: { code: "invalid_refresh_token", message: "Refresh token is invalid, expired, or reused." },
      });
    }

    if (existing.expiresAt <= new Date()) {
      clearRefreshCookie(reply);
      clearSessionCookie(reply);
      await logAuditEvent({
        actorUserId: existing.userId,
        eventType: "REFRESH_FAILURE",
        eventData: { reason: "expired" },
        ipAddress: ip,
        userAgent: ua,
      });
      return reply.code(401).send({
        error: { code: "invalid_refresh_token", message: "Refresh token is invalid or expired." },
      });
    }

    const session = await getSessionById(sessionId);
    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      await revokeRefreshTokenFamily(refreshToken);
      clearRefreshCookie(reply);
      clearSessionCookie(reply);
      await logAuditEvent({
        actorUserId: existing.userId,
        eventType: "REFRESH_FAILURE",
        eventData: { reason: "session_unavailable" },
        ipAddress: ip,
        userAgent: ua,
      });
      return reply.code(401).send({
        error: { code: "session_unavailable", message: "Session is no longer active." },
      });
    }

    const tokenSet = await rotateFirstPartyRefreshToken(refreshToken, {
      sessionId: session.id,
      ipAddress: ip,
      userAgent: ua,
    });

    if (!tokenSet) {
      clearRefreshCookie(reply);
      clearSessionCookie(reply);
      await logAuditEvent({
        actorUserId: existing.userId,
        eventType: "REFRESH_FAILURE",
        eventData: { reason: "reuse_or_invalid" },
        ipAddress: ip,
        userAgent: ua,
      });
      return reply.code(401).send({
        error: { code: "invalid_refresh_token", message: "Refresh token is invalid, expired, or reused." },
      });
    }

    const rotatedSession = await rotateAuthSession(session.id, ip, ua);
    if (!rotatedSession) {
      await revokeRefreshTokenFamily(tokenSet.refresh_token);
      clearRefreshCookie(reply);
      clearSessionCookie(reply);
      await logAuditEvent({
        actorUserId: existing.userId,
        eventType: "REFRESH_FAILURE",
        eventData: { reason: "session_rotation_failed" },
        ipAddress: ip,
        userAgent: ua,
      });
      return reply.code(401).send({
        error: { code: "session_unavailable", message: "Session is no longer active." },
      });
    }

    const authUser = await findUserById(session.userId);

    if (!authUser || authUser.status !== "ACTIVE") {
      await revokeRefreshTokenFamily(refreshToken);
      clearRefreshCookie(reply);
      clearSessionCookie(reply);
      await logAuditEvent({
        actorUserId: session.userId,
        eventType: "REFRESH_FAILURE",
        eventData: { reason: "user_unavailable" },
        ipAddress: ip,
        userAgent: ua,
      });
      return reply.code(401).send({
        error: { code: "account_unavailable", message: "Account is unavailable." },
      });
    }

    setSessionCookie(reply, rotatedSession.sessionSecret);
    setRefreshCookie(reply, tokenSet.refresh_token);

    await logAuditEvent({
      actorUserId: authUser.id,
      eventType: "REFRESH_SUCCESS",
      ipAddress: ip,
      userAgent: ua,
    });

    return reply.code(200).send({
      authenticated: true,
      access_token: tokenSet.access_token,
      token_type: tokenSet.token_type,
      expires_in: tokenSet.expires_in,
      user: toPublicUser(authUser),
      session: toSessionSummary(rotatedSession.session),
    });
  });

  // ── GET /v1/me ────────────────────────────────────────────────────
  app.get("/v1/me", { preHandler: requireAuthenticatedUser }, async (request, reply) => {
    const user = request.authUser!;
    const session = request.authSession ?? null;

    return reply.code(200).send({
      authenticated: true,
      user: toPublicUser(user),
      session: session ? toSessionSummary(session) : null,
    });
  });

  /**
   * ── GET /v1/me/security ──────────────────────────────────────────
   *
   * What an account screen needs in order to tell the truth.
   *
   * SEPARATE FROM `/v1/me` ON PURPOSE. That response is shared with signup and
   * verification, and widening its user projection would change the shape every
   * existing caller parses. This endpoint is additive, so nothing that reads
   * `/v1/me` today has to care.
   *
   * The point is that a settings screen cannot honestly render a security card
   * without these facts. `has_password` decides whether "Change password" is
   * even applicable; `mfa_enabled` decides whether the control says Enable or
   * Disable; `sign_in_methods` decides whether unlinking a provider is offered
   * at all. Guessing any of them produces a card that looks authoritative and
   * is wrong for exactly the accounts that differ from the default.
   *
   * It reports state, never secrets: no hashes, no TOTP secret, no recovery
   * codes, not even how many recovery codes remain unused.
   */
  app.get("/v1/me/security", { preHandler: requireAuthenticatedUser }, async (request, reply) => {
    const user = request.authUser!;

    const [mfaEnabled, passwordCredential, linkedIdentities] = await Promise.all([
      hasTotpEnabled(user.id),
      db.userCredential.findFirst({
        where: { userId: user.id, type: "PASSWORD", isEnabled: true },
        select: { id: true, updatedAt: true },
      }),
      db.userLinkedIdentity.findMany({
        where: { userId: user.id },
        select: { provider: true },
      }),
    ]);

    const hasPassword = Boolean(passwordCredential);
    /*
     * The same arithmetic `unlinkProvider` uses to refuse the last way in. It is
     * computed here too so the UI can DISABLE the control with a reason instead
     * of offering it and surfacing a 409 — the safeguard stays authoritative on
     * the server either way.
     */
    const signInMethods = linkedIdentities.length + (hasPassword ? 1 : 0);

    return reply.code(200).send({
      mfa_enabled: mfaEnabled,
      has_password: hasPassword,
      password_updated_at: passwordCredential?.updatedAt?.toISOString() ?? null,
      email_verified: !!user.emailVerifiedAt,
      linked_providers: linkedIdentities.map((identity) => identity.provider.toLowerCase()),
      sign_in_methods: signInMethods,
      can_unlink_a_provider: signInMethods > 1,
    });
  });

  /**
   * ── PATCH /v1/me ─────────────────────────────────────────────────
   *
   * The only profile field a person can edit here, and it is deliberately only
   * one.
   *
   * EMAIL IS NOT EDITABLE THROUGH THIS ROUTE. Changing it is an identity change,
   * not a profile edit: it needs verification of the new address before the old
   * one stops working, or it becomes an account-takeover primitive. Offering it
   * beside a display name would imply the two carry the same weight.
   */
  app.patch("/v1/me", { preHandler: requireAuthenticatedUser }, async (request, reply) => {
    const user = request.authUser!;
    const body = updateProfileSchema.parse(request.body ?? {});
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];

    // Trimmed, and an all-whitespace name is cleared rather than stored — a name
    // rendered as blank space is indistinguishable from a rendering bug.
    const trimmed = body.display_name?.trim() ?? "";
    const displayName = trimmed.length > 0 ? trimmed : null;

    const updated = await db.user.update({
      where: { id: user.id },
      data: { displayName },
    });

    await logAuditEvent({
      actorUserId: user.id,
      eventType: "PROFILE_UPDATE",
      // The VALUES are not recorded — an audit log is not a shadow copy of the
      // profile, and a display name can carry a person's legal name.
      eventData: { field: "display_name", cleared: displayName === null },
      ipAddress: ip,
      userAgent: ua,
    });

    return reply.code(200).send({ user: toPublicUser(updated) });
  });

  /**
   * ── POST /v1/me/email/change ─────────────────────────────────────
   *
   * Step one of moving an account to a new address: prove you control it.
   *
   * NOTHING CHANGES HERE. The account keeps its current address until a code
   * sent to the NEW one comes back. Writing the new address first — even
   * unverified — would let anyone who reaches a signed-in screen redirect the
   * account's password resets to an address they own, which turns a settings
   * field into an account-takeover primitive.
   *
   * The code goes to the NEW address, never the old one. The question being
   * asked is "do you control this new mailbox", and only the new mailbox can
   * answer it.
   */
  app.post("/v1/me/email/change", { preHandler: requireAuthenticatedUser }, async (request, reply) => {
    const user = request.authUser!;
    const body = requestEmailChangeSchema.parse(request.body);
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];

    const parsed = tryParseIdentifier(body.email);
    if (!parsed.ok || parsed.value.kind !== "EMAIL") {
      return reply.code(400).send({
        error: { code: "invalid_identifier", message: "Enter a valid email address." },
      });
    }

    if (parsed.value.normalized === user.email) {
      return reply.code(400).send({
        error: { code: "same_address", message: "That is already your email address." },
      });
    }

    /*
     * TAKEN BY SOMEONE ELSE IS REFUSED, and refused the same way whoever asks.
     * The address is globally unique, so this is not an enumeration leak the
     * signup flow does not already have — and letting it through would only
     * surface later as an opaque database error after a code had been sent.
     */
    const existing = await findIdentifierByParsedValue(parsed.value);
    if (existing && existing.userId !== user.id) {
      return reply.code(409).send({
        error: { code: "identifier_taken", message: "That email address is already in use." },
      });
    }

    /*
     * The pending identifier is created UNVERIFIED and is not the account's
     * address until the challenge is consumed. Reusing an existing pending row
     * for the same user keeps a second attempt from colliding with the first.
     */
    const identifier =
      existing ??
      (await db.userIdentifier.create({
        data: {
          userId: user.id,
          kind: "EMAIL",
          normalizedValue: parsed.value.normalized,
          displayValue: body.email,
          isVerified: false,
          isPrimary: false,
        },
      }));

    const challenge = await createVerificationChallenge({
      userId: user.id,
      identifierId: identifier.id,
      kind: "CHANGE_IDENTIFIER",
      channel: "EMAIL",
      ipAddress: ip,
      userAgent: ua,
    });

    await sendVerificationCode({
      channel: "EMAIL",
      destination: parsed.value.normalized,
      code: challenge.code,
    });

    await logAuditEvent({
      actorUserId: user.id,
      eventType: "EMAIL_CHANGE_REQUESTED",
      // The destination is masked. An audit log that records the address in
      // clear becomes a second place the address has to be protected.
      eventData: {
        to: maskIdentifier({ kind: "EMAIL", normalized: parsed.value.normalized }),
      },
      ipAddress: ip,
      userAgent: ua,
    });

    return reply.code(202).send({
      challenge_id: challenge.challenge.id,
      sent_to: maskIdentifier({ kind: "EMAIL", normalized: parsed.value.normalized }),
      message: "Enter the code sent to your new address to finish the change.",
    });
  });

  /**
   * ── POST /v1/me/email/confirm ────────────────────────────────────
   *
   * Step two: the code came back, so the address is proven and the swap happens.
   *
   * The challenge is consumed with an EXPECTED KIND. Without that, a code issued
   * for signup verification or a password reset would be accepted here — codes
   * are interchangeable digits, and only the kind distinguishes what the person
   * was actually asked to approve.
   */
  app.post("/v1/me/email/confirm", { preHandler: requireAuthenticatedUser }, async (request, reply) => {
    const user = request.authUser!;
    const body = confirmEmailChangeSchema.parse(request.body);
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];

    const challenge = await getVerificationChallenge(body.challenge_id);
    /*
     * BOUND TO THIS USER. A challenge id is a bearer value; without this check a
     * signed-in attacker holding someone else's challenge id could complete
     * that person's change against their own session.
     */
    if (!challenge || challenge.userId !== user.id) {
      return reply.code(400).send({
        error: { code: "invalid_challenge", message: "That verification is no longer valid." },
      });
    }

    const consumed = await consumeVerificationChallenge({
      challengeId: body.challenge_id,
      code: body.code,
      expectedKind: "CHANGE_IDENTIFIER",
    });
    if (!consumed.ok) {
      const failure = challengeFailureResponse(consumed.reason);
      return reply.code(failure.status).send(failure.body);
    }

    /*
     * A challenge can exist without an identifier — the column is nullable, and
     * some kinds are issued against the user alone. Coercing it here would turn
     * "this challenge points at no address" into a lookup for the id `null`, so
     * it is checked rather than asserted away.
     */
    const identifier = consumed.challenge.identifierId
      ? await db.userIdentifier.findUnique({ where: { id: consumed.challenge.identifierId } })
      : null;
    if (!identifier || identifier.userId !== user.id) {
      return reply.code(400).send({
        error: { code: "invalid_challenge", message: "That verification is no longer valid." },
      });
    }

    const updated = await completeEmailChange({
      userId: user.id,
      identifierId: identifier.id,
      normalizedEmail: identifier.normalizedValue,
      displayEmail: identifier.displayValue ?? identifier.normalizedValue,
    });

    await logAuditEvent({
      actorUserId: user.id,
      eventType: "EMAIL_CHANGED",
      eventData: { to: maskIdentifier({ kind: "EMAIL", normalized: identifier.normalizedValue }) },
      ipAddress: ip,
      userAgent: ua,
    });

    return reply.code(200).send({ user: toPublicUser(updated) });
  });

  /**
   * ── POST /v1/me/close ────────────────────────────────────────────
   *
   * Closing the account.
   *
   * EVERY SESSION AND REFRESH TOKEN DIES HERE, not eventually. `closeUserAccount`
   * sets DISABLED, which the session middleware already refuses on every request
   * — but a live refresh token would otherwise keep minting access for its full
   * lifetime, so the token families are revoked explicitly too.
   *
   * A soft delete, and the reasoning is in `closeUserAccount`: the identity
   * provider is the audit trail for every sign-in that ever happened, and a hard
   * delete would cascade that away including the record of this deletion. Access
   * ends completely; history does not vanish. The addresses ARE released, so the
   * person can sign up again with their own email.
   */
  app.post("/v1/me/close", { preHandler: requireAuthenticatedUser }, async (request, reply) => {
    const user = request.authUser!;
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];

    // Server-checked, because a confirmation enforced only in a screen is not
    // enforced for anything that skips the screen.
    const parsed = closeAccountSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: "confirmation_required", message: "This action needs an explicit confirmation." },
      });
    }

    /*
     * AUDITED BEFORE THE ACT, not after. Once the account is closed the actor
     * row it references is disabled, and a failure between the two would
     * otherwise leave the most consequential action in the system unrecorded.
     */
    await logAuditEvent({
      actorUserId: user.id,
      eventType: "ACCOUNT_CLOSED",
      eventData: { soft_delete: true },
      ipAddress: ip,
      userAgent: ua,
    });

    await closeUserAccount(user.id);
    await revokeAllUserSessions(user.id);

    const refreshToken = (request as RequestWithCookies).cookies[config.refreshCookieName];
    if (refreshToken) await revokeRefreshTokenFamily(refreshToken);

    clearSessionCookie(reply);
    clearRefreshCookie(reply);

    return reply.code(200).send({ closed: true });
  });

  // ── POST /v1/logout ───────────────────────────────────────────────
  app.post("/v1/logout", { preHandler: requireSession }, async (request, reply) => {
    const session = request.authSession!;
    const user = request.authUser!;
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];

    const body = logoutSchema.parse(request.body ?? {});
    const refreshToken = (request as RequestWithCookies).cookies[config.refreshCookieName];

    if (body.global) {
      await revokeAllUserSessions(user.id);
    } else {
      await revokeSession(session.id);
    }
    if (refreshToken) {
      await revokeRefreshTokenFamily(refreshToken);
    }
    clearSessionCookie(reply);
    clearRefreshCookie(reply);

    await logAuditEvent({
      actorUserId: user.id,
      eventType: "LOGOUT",
      eventData: { global: body.global },
      ipAddress: ip,
      userAgent: ua,
    });

    return reply.code(200).send({ logged_out: true });
  });

  // ── POST /v1/verify-email ─────────────────────────────────────────
  app.post("/v1/verify-email", async (request, reply) => {
    const body = verifyEmailSchema.parse(request.body);

    const result = await consumeEmailVerification(body.token);
    if (!result) {
      return reply.code(400).send({
        error: { code: "invalid_token", message: "Verification link is invalid or expired." },
      });
    }

    await markEmailVerified(result.userId);

    await logAuditEvent({
      actorUserId: result.userId,
      eventType: "EMAIL_VERIFIED",
    });

    return reply.code(200).send({
      success: true,
      message: "Email verified.",
    });
  });

  // ── POST /v1/resend-verification ──────────────────────────────────
  app.post("/v1/resend-verification", async (request, reply) => {
    const body = resendVerificationSchema.parse(request.body);
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];

    let identifier: UserIdentifier | null = null;
    let userId: string | null = null;

    if (body.challenge_id) {
      const existing = await getVerificationChallenge(body.challenge_id);
      identifier = existing?.identifier ?? null;
      userId = existing?.userId ?? null;
    } else if (body.identifier) {
      const parsedIdentifier = tryParseIdentifier(body.identifier);
      if (!parsedIdentifier.ok) {
        return reply.code(400).send({
          error: { code: "invalid_identifier", message: parsedIdentifier.message },
        });
      }
      const match = await findUserByIdentifier(parsedIdentifier.value);
      identifier = match?.identifier ?? null;
      userId = match?.user.id ?? null;
    }

    if (!identifier || !userId) {
      return reply.code(200).send({
        sent: true,
        resend_after_seconds: config.verificationResendCooldownSec,
        message: "If this identifier can be verified, a new code has been sent.",
      });
    }

    const latestChallenge = await getLatestVerificationChallengeForIdentifier({
      identifierId: identifier.id,
      kind: "SIGNUP_VERIFY",
    });
    if (
      latestChallenge
      && latestChallenge.createdAt.getTime() + config.verificationResendCooldownSec * 1000 > Date.now()
    ) {
      const retryAfterMs = latestChallenge.createdAt.getTime() + config.verificationResendCooldownSec * 1000 - Date.now();
      return reply.code(429).send({
        error: { code: "resend_cooldown", message: "Wait before requesting another code." },
        resend_after_seconds: Math.ceil(retryAfterMs / 1000),
      });
    }

    const verification = await issueVerificationChallenge({
      userId,
      identifier,
      ip,
      userAgent: ua,
      kind: "SIGNUP_VERIFY",
    });

    return reply.code(200).send({
      sent: true,
      challenge_id: verification.challengeId,
      channel: verification.channel,
      masked_destination: verification.maskedDestination,
      resend_after_seconds: config.verificationResendCooldownSec,
      message: "A fresh verification code has been sent.",
    });
  });

  // ── POST /v1/forgot-password ──────────────────────────────────────
  app.post("/v1/forgot-password", async (request, reply) => {
    const body = forgotPasswordSchema.parse(request.body);
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];

    const parsedIdentifier = tryParseIdentifier(body.identifier);
    if (!parsedIdentifier.ok) {
      return reply.code(400).send({
        error: { code: "invalid_identifier", message: parsedIdentifier.message },
      });
    }
    const result = await findUserByIdentifier(parsedIdentifier.value);

    if (result && result.identifier.isVerified) {
      if (result.identifier.kind === "EMAIL") {
        const token = await createPasswordResetToken(result.user.id, ip, ua);
        await sendPasswordResetNotification({
          channel: "EMAIL",
          destination: result.identifier.normalizedValue,
          tokenOrCode: token,
          clientId: body.client_id,
        }).catch((err) => {
          console.error("Failed to send password reset email:", err);
        });
      } else {
        const resetChallenge = await createVerificationChallenge({
          userId: result.user.id,
          identifierId: result.identifier.id,
          kind: "RESET_PASSWORD",
          channel: "SMS",
          ipAddress: ip,
          userAgent: ua,
        });
        await sendPasswordResetNotification({
          channel: "SMS",
          destination: result.identifier.normalizedValue,
          tokenOrCode: resetChallenge.code,
          clientId: body.client_id,
        }).catch((err) => {
          console.error("Failed to send password reset code:", err);
        });

        await logAuditEvent({
          actorUserId: result.user.id,
          eventType: "PASSWORD_RESET_REQUEST",
          eventData: {
            identifier: result.identifier.normalizedValue,
            channel: "sms",
          },
          ipAddress: ip,
          userAgent: ua,
        });

        return reply.code(200).send({
          sent: true,
          challenge_id: resetChallenge.challenge.id,
          channel: "sms",
          masked_destination: maskIdentifier({
            kind: result.identifier.kind,
            normalized: result.identifier.normalizedValue,
          }),
          message: "If this phone number is registered, a reset code has been sent.",
        });
      }

      await logAuditEvent({
        actorUserId: result.user.id,
        eventType: "PASSWORD_RESET_REQUEST",
        eventData: { identifier: result.identifier.normalizedValue },
        ipAddress: ip,
        userAgent: ua,
      });
    }

    return reply.code(200).send({
      sent: true,
      message: "If this identifier is registered, password recovery instructions have been sent.",
    });
  });

  // ── POST /v1/reset-password ───────────────────────────────────────
  app.post("/v1/reset-password", async (request, reply) => {
    const body = resetPasswordSchema.parse(request.body);
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];

    let userId: string | null = null;

    if (body.token) {
      const result = await consumePasswordReset(body.token);
      if (!result) {
        return reply.code(400).send({
          error: { code: "invalid_token", message: "Reset link is invalid or expired." },
        });
      }
      userId = result.userId;
    } else if (body.challenge_id && body.code) {
      const challengeResult = await consumeVerificationChallenge({
        challengeId: body.challenge_id,
        code: body.code,
        expectedKind: "RESET_PASSWORD",
      });

      if (!challengeResult.ok) {
        const failure = challengeFailureResponse(challengeResult.reason);
        return reply.code(failure.status).send(failure.body);
      }

      userId = challengeResult.challenge.userId ?? null;
    }

    if (!userId) {
      return reply.code(400).send({
        error: { code: "invalid_reset", message: "Reset request is invalid or expired." },
      });
    }

    await changePassword(userId, body.password);
    await revokeAllUserSessions(userId);

    await logAuditEvent({
      actorUserId: userId,
      eventType: "PASSWORD_RESET_COMPLETE",
      ipAddress: ip,
      userAgent: ua,
    });

    return reply.code(200).send({
      success: true,
      message: "Password has been reset. Please sign in with your new password.",
    });
  });
}
