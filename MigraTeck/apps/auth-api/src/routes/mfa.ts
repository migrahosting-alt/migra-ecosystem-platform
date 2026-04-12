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
} from "../modules/mfa/index.js";
import { verifyUserPassword } from "../modules/users/index.js";
import { logAuditEvent } from "../modules/audit/index.js";
import { requireSession, getClientIp } from "../middleware/session.js";

export async function mfaRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /v1/mfa/totp/enroll ──────────────────────────────────────
  app.post("/v1/mfa/totp/enroll", { preHandler: requireSession }, async (request, reply) => {
    const user = request.authUser!;

    try {
      const result = await enrollTotp(user.id, user.email);

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
  app.post("/v1/mfa/totp/verify", { preHandler: requireSession }, async (request, reply) => {
    const user = request.authUser!;
    const body = totpVerifySchema.parse(request.body);
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];

    // Try confirming enrollment first (with optional challenge_id), then regular verify
    const confirmed = await confirmTotpEnrollment(user.id, body.code, body.challenge_id);
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

    const valid = await verifyTotp(user.id, body.code);
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

    return reply.code(200).send({ message: "TOTP verified.", verified: true });
  });

  // ── POST /v1/mfa/disable ─────────────────────────────────────────
  app.post("/v1/mfa/disable", { preHandler: requireSession }, async (request, reply) => {
    const user = request.authUser!;
    const body = mfaDisableSchema.parse(request.body);
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];

    // Require password confirmation to disable MFA
    const valid = await verifyUserPassword(user, body.password);
    if (!valid) {
      return reply.code(401).send({ error: { code: "invalid_password", message: "Incorrect password." } });
    }

    await disableTotp(user.id);

    await logAuditEvent({
      actorUserId: user.id,
      eventType: "MFA_DISABLE",
      eventData: { method: "totp" },
      ipAddress: ip,
      userAgent: ua,
    });

    return reply.code(200).send({ success: true, message: "MFA disabled." });
  });
}
