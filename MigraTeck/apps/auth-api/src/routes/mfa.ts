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
  hasTotpEnabled,
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
       * ── WHICH PRODUCT THIS AUTHENTICATOR ENTRY NAMES ──────────────────
       *
       * `authClientId` comes from a SIGNED token and is the strongest answer
       * when there is one — but it is unset for cookie-session enrolments,
       * which is how anyone enrolling through MigraAuth's own UI reaches this.
       * That covered the API case and left the browser case falling back to
       * platform branding: enrolling from MigraPilot saved "MigraTeck" into the
       * authenticator app, and an entry named after the wrong product is the
       * one thing an authenticator list has to get right — it is read months
       * later, out of context, beside a dozen others.
       *
       * The session now records the product it was established for, stamped
       * server-side when a transaction was consumed, so the browser case has a
       * trusted answer too. Session context is preferred over the token because
       * this route is reached by a browser far more often than by an API caller
       * holding a scoped token, and both are server state either way — neither
       * is supplied by the caller.
       */
      const issuer = await resolveMfaIssuer(
        request.authSession?.clientId ?? request.authClientId,
      );
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

  /**
   * ── POST /v1/mfa/recovery-codes ──────────────────────────────────
   *
   * Replace this account's recovery codes with a fresh set.
   *
   * WHY THIS ROUTE HAD TO EXIST. Every set issued before the store/consume hash
   * mismatch was fixed is structurally unredeemable, and the only way to get a
   * working one was to DISABLE MFA and enrol again — telling people to remove
   * their second factor in order to repair their fallback, and handing them a
   * window with neither. That is a worse instruction than the problem.
   *
   * ONLY WHEN MFA IS ON. Recovery codes exist to answer a challenge; minting
   * them for an account with no second factor creates a standing credential
   * nothing asked for and nothing will ever demand.
   *
   * RE-AUTHENTICATED WITH WHATEVER THIS ACCOUNT HAS, in the same order as
   * `/v1/mfa/disable`: password, then an authenticator code, then a recovery
   * code last so one is never spent on a request a cheaper proof would have
   * satisfied. A recovery code IS accepted, deliberately — someone whose
   * authenticator is gone is exactly who needs a fresh set, and refusing them
   * here would recreate the dead end this route removes.
   *
   * SHOWN ONCE. The response is the only time the plaintext exists; only hashes
   * are stored, so there is no endpoint that can ever show them again.
   */
  app.post("/v1/mfa/recovery-codes", { preHandler: requireAuthenticatedUser }, async (request, reply) => {
    const user = request.authUser!;
    const body = mfaDisableSchema.parse(request.body);
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];

    if (!(await hasTotpEnabled(user.id))) {
      return reply.code(409).send({
        error: {
          code: "mfa_not_enabled",
          message: "Turn on two-step verification first — recovery codes back up a second factor.",
        },
      });
    }

    let method: "password" | "totp" | "recovery_code" | null = null;
    if (body.password && (await verifyUserPassword(user, body.password))) method = "password";
    if (!method && body.code) {
      if (await verifyTotp(user.id, body.code)) method = "totp";
      else if (await consumeRecoveryCode(user.id, body.code)) method = "recovery_code";
    }

    if (!method) {
      await logAuditEvent({
        actorUserId: user.id,
        eventType: "MFA_RECOVERY_CODES_FAILURE",
        eventData: { reason: "reauthentication_failed" },
        ipAddress: ip,
        userAgent: ua,
      });
      return reply.code(401).send({
        error: {
          code: "reauthentication_failed",
          message: "That did not match. Use your password, an authenticator code, or a recovery code.",
        },
      });
    }

    /*
     * The previous set is replaced atomically by `storeRecoveryCodes`, so there
     * is no instant where the account holds neither the old codes nor the new.
     * A code consumed to authorise THIS request is discarded with the rest of
     * the set it belonged to, which is the intended outcome.
     */
    const codes = generateRecoveryCodes(10);
    await storeRecoveryCodes(user.id, codes);

    await logAuditEvent({
      actorUserId: user.id,
      eventType: "MFA_RECOVERY_CODES_REGENERATED",
      // How it was authorised, and how many now exist. Never the codes.
      eventData: { reauthenticated_with: method, count: codes.length },
      ipAddress: ip,
      userAgent: ua,
    });

    return reply.code(200).send({
      recovery_codes: codes,
      count: codes.length,
      message: "These replace any codes you had before. Save them now — they cannot be shown again.",
    });
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
