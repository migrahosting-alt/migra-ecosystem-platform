/**
 * Auth routes — signup, login, logout, email verification, password reset.
 * Response shapes aligned to openapi.yaml.
 */
import type { FastifyInstance } from "fastify";
import {
  signupSchema,
  loginSchema,
  logoutSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  resendVerificationSchema,
} from "../lib/schemas.js";
import {
  createUser,
  findUserByEmail,
  verifyUserPassword,
  markEmailVerified,
  createEmailVerification,
  consumeEmailVerification,
  createPasswordResetToken,
  consumePasswordReset,
  changePassword,
  updateLastLogin,
} from "../modules/users/index.js";
import {
  createAuthSession,
  revokeSession,
  revokeAllUserSessions,
} from "../modules/sessions/index.js";
import { hasTotpEnabled } from "../modules/mfa/index.js";
import { logAuditEvent } from "../modules/audit/index.js";
import { sendVerificationEmail, sendPasswordResetEmail } from "../lib/email.js";
import { config } from "../config/env.js";
import { requireSession, getClientIp } from "../middleware/session.js";

function setSessionCookie(
  reply: import("fastify").FastifyReply,
  sessionSecret: string,
): void {
  reply.setCookie(config.sessionCookieName, sessionSecret, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "lax",
    path: "/",
    domain: config.cookieDomain,
    maxAge: config.sessionTtl,
  });
}

function clearSessionCookie(reply: import("fastify").FastifyReply): void {
  reply.clearCookie(config.sessionCookieName, {
    path: "/",
    domain: config.cookieDomain,
  });
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /v1/signup ───────────────────────────────────────────────
  app.post("/v1/signup", async (request, reply) => {
    const body = signupSchema.parse(request.body);
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];

    // Check uniqueness
    const existing = await findUserByEmail(body.email);
    if (existing) {
      return reply.code(409).send({
        error: { code: "email_taken", message: "An account with this email already exists." },
      });
    }

    // Create user (password stored in user_credentials)
    const user = await createUser(body.email, body.password, body.display_name);

    // Create verification token & send email
    const token = await createEmailVerification(user.id);
    await sendVerificationEmail(user.email, token).catch((err) => {
      console.error("Failed to send verification email:", err);
    });

    // Create session
    const { sessionSecret } = await createAuthSession(user.id, ip, ua);
    setSessionCookie(reply, sessionSecret);

    await logAuditEvent({
      actorUserId: user.id,
      eventType: "SIGNUP",
      clientId: body.client_id,
      ipAddress: ip,
      userAgent: ua,
    });

    return reply.code(201).send({
      user: {
        id: user.id,
        email: user.email,
        status: user.status,
        email_verified: false,
      },
      message: "Account created. Check your email to verify.",
    });
  });

  // ── POST /v1/login ────────────────────────────────────────────────
  app.post("/v1/login", async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];

    const user = await findUserByEmail(body.email);

    if (!user) {
      await logAuditEvent({
        eventType: "LOGIN_FAILURE",
        eventData: { email: body.email, reason: "not_found" },
        ipAddress: ip,
        userAgent: ua,
      });
      return reply.code(401).send({
        error: { code: "invalid_credentials", message: "Invalid email or password." },
      });
    }

    // Check account status
    if (user.status === "LOCKED") {
      return reply.code(403).send({
        error: { code: "account_locked", message: "Account is locked. Please try again later or reset your password." },
      });
    }
    if (user.status === "DISABLED") {
      return reply.code(403).send({
        error: { code: "account_disabled", message: "Account has been disabled." },
      });
    }

    // Verify password (now via user_credentials)
    const valid = await verifyUserPassword(user, body.password);
    if (!valid) {
      await logAuditEvent({
        actorUserId: user.id,
        eventType: "LOGIN_FAILURE",
        eventData: { reason: "wrong_password" },
        ipAddress: ip,
        userAgent: ua,
      });
      return reply.code(401).send({
        error: { code: "invalid_credentials", message: "Invalid email or password." },
      });
    }

    // Check MFA requirement
    const mfaRequired = await hasTotpEnabled(user.id);
    if (mfaRequired) {
      const { sessionSecret } = await createAuthSession(user.id, ip, ua);
      setSessionCookie(reply, sessionSecret);
      return reply.code(200).send({
        authenticated: false,
        requires_mfa: true,
      });
    }

    // Create session
    const { sessionSecret } = await createAuthSession(user.id, ip, ua);
    setSessionCookie(reply, sessionSecret);
    await updateLastLogin(user.id);

    await logAuditEvent({
      actorUserId: user.id,
      eventType: "LOGIN_SUCCESS",
      clientId: body.client_id,
      ipAddress: ip,
      userAgent: ua,
    });

    return reply.code(200).send({
      authenticated: true,
      requires_mfa: false,
      user: {
        id: user.id,
        email: user.email,
        status: user.status,
        email_verified: !!user.emailVerifiedAt,
        display_name: user.displayName ?? undefined,
      },
    });
  });

  // ── POST /v1/logout ───────────────────────────────────────────────
  app.post("/v1/logout", { preHandler: requireSession }, async (request, reply) => {
    const session = request.authSession!;
    const user = request.authUser!;
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];

    const body = logoutSchema.parse(request.body ?? {});

    if (body.global) {
      await revokeAllUserSessions(user.id);
    } else {
      await revokeSession(session.id);
    }
    clearSessionCookie(reply);

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

    const user = await findUserByEmail(body.email);
    if (user && !user.emailVerifiedAt) {
      const token = await createEmailVerification(user.id);
      await sendVerificationEmail(user.email, token).catch((err) => {
        console.error("Failed to send verification email:", err);
      });
    }

    return reply.code(200).send({
      sent: true,
      message: "If this email is registered and unverified, a new verification link has been sent.",
    });
  });

  // ── POST /v1/forgot-password ──────────────────────────────────────
  app.post("/v1/forgot-password", async (request, reply) => {
    const body = forgotPasswordSchema.parse(request.body);
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];

    const user = await findUserByEmail(body.email);
    if (user) {
      const token = await createPasswordResetToken(user.id, ip, ua);
      await sendPasswordResetEmail(user.email, token).catch((err) => {
        console.error("Failed to send password reset email:", err);
      });

      await logAuditEvent({
        actorUserId: user.id,
        eventType: "PASSWORD_RESET_REQUEST",
        ipAddress: ip,
        userAgent: ua,
      });
    }

    return reply.code(200).send({
      sent: true,
      message: "If this email is registered, a password reset link has been sent.",
    });
  });

  // ── POST /v1/reset-password ───────────────────────────────────────
  app.post("/v1/reset-password", async (request, reply) => {
    const body = resetPasswordSchema.parse(request.body);
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];

    const result = await consumePasswordReset(body.token);
    if (!result) {
      return reply.code(400).send({
        error: { code: "invalid_token", message: "Reset link is invalid or expired." },
      });
    }

    await changePassword(result.userId, body.password);
    await revokeAllUserSessions(result.userId);

    await logAuditEvent({
      actorUserId: result.userId,
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
