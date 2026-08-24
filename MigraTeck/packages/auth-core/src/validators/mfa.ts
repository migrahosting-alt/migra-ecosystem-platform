import { z } from "zod";
import { uuidSchema } from "./shared.js";

export const enrollTotpSchema = z.object({});

export const verifyTotpSchema = z.object({
  challenge_id: uuidSchema.optional(),
  code: z.string().regex(/^\d{6}$/),
});

/**
 * Turning MFA off — re-authenticated, but not necessarily by a password.
 *
 * THIS USED TO REQUIRE A PASSWORD, WHICH LOCKED PEOPLE IN. An account created
 * through Google or GitHub has no PASSWORD credential, and `verifyUserPassword`
 * returns false when there is none — so a provider-only user who enrolled TOTP
 * could never disable it. Every attempt answered "Incorrect password" about a
 * password that had never existed. The way out was a support ticket.
 *
 * Re-authentication is still required; what counts has widened to the things
 * such a user actually has. A live TOTP code or an unused recovery code proves
 * possession of the second factor at least as well as the password proves
 * knowledge — this is the same evidence the factor itself is built on.
 *
 * At least one must be supplied. An empty body is refused by the shape, so the
 * route can never read "no credential offered" as "credential accepted".
 */
export const mfaDisableSchema = z
  .object({
    password: z.string().min(1).max(128).optional(),
    /** A 6-digit TOTP code, or a recovery code. */
    code: z.string().min(6).max(64).optional(),
  })
  .refine((body) => Boolean(body.password ?? body.code), {
    message: "Provide your password, an authenticator code, or a recovery code.",
  });

export const deleteMfaMethodSchema = mfaDisableSchema;
