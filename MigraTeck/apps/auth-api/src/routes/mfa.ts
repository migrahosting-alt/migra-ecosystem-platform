/**
 * MFA routes — TOTP enrollment, verification, disable.
 */
import type { FastifyInstance } from "fastify";
import { totpVerifySchema, mfaDisableSchema } from "../lib/schemas.js";
import {
  enrollTotp,
  confirmTotpEnrollment,
  verifyTotp,
  disableTotp,
  generateRecoveryCodes,
  storeRecoveryCodes,
  consumeRecoveryCode,
  resolveMfaIssuer,
} from "../modules/mfa/index.js";
import { verifyUserPassword } from "../modules/users/index.js";
import { logAuditEvent } from "../modules/audit/index.js";
import {
  requireAuthenticatedUser,
  requireMfaChallengeOrUser,
  getClientIp,
} from "../middleware/session.js";
import { promoteSessionAfterMfa } from "../modules/sessions/index.js";
import { issueFirstPartyRefreshToken } from "../modules/tokens/index.js";
import { setRefreshCookie } from "./auth.js";

export async function mfaRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /v1/mfa/totp/enroll ──────────────────────────────────────
  app.post("/v1/mfa/totp/enroll", { preHandler: requireAuthenticatedUser }, async (request, reply) => {
    const user = request.authUser!;

    try {
      /*
       * The issuer comes from the SIGNED token's client, so the authenticator
       * entry is labelled with the product the person actually enrolled from.
       * `authClientId` is unset for cookie-session enrolments (MigraAuth's own
       * UI), which correctly fall back to platform branding.
       */
      const issuer = await resolveMfaIssuer(request.authClientId);
      const result = await enrollTotp(
        user.id,
        user.email ?? user.phoneE164 ?? user.id,
        issuer,
      );

      return reply.code(200).send({
        challenge_id: result.challengeId,
        secret: result.secret,
        otpauth_uri: result.otpauthUri,
        recovery_codes: result.recoveryCodes,
        message: "Scan the QR code with your authenticator app, then confirm with a code.",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      if (msg === "TOTP already enrolled") {
        return reply.code(409).send({ error: { code: "already_enrolled", message: msg } });
      }
      throw err;
    }
  });

  // ── POST /v1/mfa/totp/verify ─────────────────────────────────────
  app.post("/v1/mfa/totp/verify", { preHandler: requireMfaChallengeOrUser }, async (request, reply) => {
    const user = request.authUser!;
    const body = totpVerifySchema.parse(request.body);
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];

    const recoveryCode = body.recoveryCode ?? body.recovery_code;

    /*
     * A RECOVERY CODE ANSWERS A LOGIN CHALLENGE, NEVER AN ENROLMENT.
     *
     * Confirming an enrolment has to prove the authenticator actually works;
     * letting a recovery code do it would enable a factor nobody had verified
     * they can produce — and the codes were issued moments earlier by the very
     * enrolment being confirmed. So this branch is only reachable while a
     * session is MFA-pending, i.e. someone signing in.
     */
    if (recoveryCode) {
      if (!request.mfaPending) {
        return reply.code(400).send({
          error: {
            code: "recovery_code_not_applicable",
            message: "Confirm this enrolment with a code from your authenticator app.",
          },
        });
      }
      if (!(await consumeRecoveryCode(user.id, recoveryCode))) {
        return reply
          .code(401)
          .send({ error: { code: "invalid_code", message: "That recovery code is not valid." } });
      }

      const promoted = await promoteSessionAfterMfa(request.authSession!.id);
      if (!promoted) {
        return reply.code(409).send({
          error: { code: "session_not_pending", message: "That sign-in is no longer waiting for a code." },
        });
      }
      setRefreshCookie(
        reply,
        await issueFirstPartyRefreshToken({
          userId: user.id,
          sessionId: request.authSession!.id,
          ipAddress: ip,
          userAgent: ua,
        }),
      );

      await logAuditEvent({
        actorUserId: user.id,
        eventType: "MFA_VERIFY",
        // Recorded distinctly: a sign-in that consumed a recovery code means
        // the authenticator is probably gone, and that is worth seeing.
        eventData: { method: "recovery_code" },
        ipAddress: ip,
        userAgent: ua,
      });
      return reply.code(200).send({ message: "Recovery code accepted.", verified: true });
    }

    // Try confirming enrollment first (with optional challenge_id), then regular verify
    const confirmed = await confirmTotpEnrollment(user.id, body.code!, body.challenge_id);
    if (confirmed) {
      await logAuditEvent({
        actorUserId: user.id,
        eventType: "MFA_ENROLL",
        eventData: { method: "totp" },
        ipAddress: ip,
        userAgent: ua,
      });
      return reply.code(200).send({ message: "TOTP enrolled successfully.", verified: true });
    }

    const valid = await verifyTotp(user.id, body.code!);
    if (!valid) {
      return reply.code(401).send({ error: { code: "invalid_code", message: "Invalid TOTP code." } });
    }

    await logAuditEvent({
      actorUserId: user.id,
      eventType: "MFA_VERIFY",
      eventData: { method: "totp" },
      ipAddress: ip,
      userAgent: ua,
    });

    /*
     * ── PROMOTION IS THE POINT OF THIS ENDPOINT ────────────────────────
     *
     * The factor is proved, so the half-authenticated session becomes a real
     * one and gets the refresh token it was deliberately denied until now.
     * Until this runs, `validateSession` refuses the session everywhere.
     *
     * A promotion that matches no row is NOT success: it means the session was
     * not pending (already promoted, revoked, or someone else's). Saying
     * "verified" then would hand back a session that still cannot be used.
     */
    if (request.mfaPending) {
      const promoted = await promoteSessionAfterMfa(request.authSession!.id);
      if (!promoted) {
        return reply.code(409).send({
          error: { code: "session_not_pending", message: "That sign-in is no longer waiting for a code." },
        });
      }

      const refreshToken = await issueFirstPartyRefreshToken({
        userId: user.id,
        sessionId: request.authSession!.id,
        ipAddress: ip,
        userAgent: ua,
      });
      setRefreshCookie(reply, refreshToken);
    }

    return reply.code(200).send({ message: "TOTP verified.", verified: true });
  });

  // ── POST /v1/mfa/disable ─────────────────────────────────────────
  app.post("/v1/mfa/disable", { preHandler: requireAuthenticatedUser }, async (request, reply) => {
    const user = request.authUser!;
    const body = mfaDisableSchema.parse(request.body);
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];

    /*
     * RE-AUTHENTICATE WITH WHATEVER THIS USER ACTUALLY HAS.
     *
     * The password branch alone made this route unreachable for anyone who
     * signed up through Google or GitHub: they have no PASSWORD credential,
     * `verifyUserPassword` returns false for the missing row, and the answer was
     * "Incorrect password" about a password that never existed. Enrolling TOTP
     * was therefore a one-way door for exactly the accounts most likely to use
     * a provider.
     *
     * Each branch is still a real proof, and the checks are ORDERED so a
     * recovery code is only consumed once the cheaper checks have failed —
     * consuming one to answer a request that a TOTP code would have satisfied
     * would burn a code the user may need later.
     */
    let reauthenticated = false;
    let method: "password" | "totp" | "recovery_code" | null = null;

    if (body.password) {
      reauthenticated = await verifyUserPassword(user, body.password);
      if (reauthenticated) method = "password";
    }
    if (!reauthenticated && body.code) {
      if (await verifyTotp(user.id, body.code)) {
        reauthenticated = true;
        method = "totp";
      } else if (await consumeRecoveryCode(user.id, body.code)) {
        reauthenticated = true;
        method = "recovery_code";
      }
    }

    if (!reauthenticated) {
      return reply.code(401).send({
        error: {
          code: "reauthentication_failed",
          // Deliberately does not say WHICH credential was wrong, or whether a
          // password exists on this account — that is an account-enumeration
          // detail, and the caller already knows what they sent.
          message: "That did not match. Use your password, an authenticator code, or a recovery code.",
        },
      });
    }

    await disableTotp(user.id);

    await logAuditEvent({
      actorUserId: user.id,
      eventType: "MFA_DISABLE",
      // Records HOW it was authorised, not just that it happened — a disable
      // authorised by a recovery code is a different security story from one
      // authorised by a password, and the audit trail should be able to tell
      // them apart afterwards.
      eventData: { method: "totp", reauthenticated_with: method },
      ipAddress: ip,
      userAgent: ua,
    });

    return reply.code(200).send({ success: true, message: "MFA disabled." });
  });
}
