import { z } from "zod";
import { uuidSchema } from "./shared.js";

export const enrollTotpSchema = z.object({});

/**
 * Answering a second-factor challenge.
 *
 * EITHER an authenticator code OR a recovery code. The recovery branch existed
 * in the UI — the challenge page has a "use a recovery code" toggle and posts
 * `recoveryCode` — while this schema demanded a six-digit `code`, so every
 * attempt was rejected as malformed. A person who had lost their authenticator
 * had a button that could not work, which is the worst possible moment for one.
 *
 * `recoveryCode` matches what the page already sends; `recovery_code` is
 * accepted too so the API reads consistently with the rest of the surface.
 */
export const verifyTotpSchema = z
  .object({
    challenge_id: uuidSchema.optional(),
    code: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    recoveryCode: z.string().min(6).max(64).optional(),
    recovery_code: z.string().min(6).max(64).optional(),
  })
  .refine((body) => Boolean(body.code ?? body.recoveryCode ?? body.recovery_code), {
    message: "Provide an authenticator code or a recovery code.",
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
