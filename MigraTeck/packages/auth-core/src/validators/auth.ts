import { z } from "zod";
import {
  emailSchema,
  passwordSchema,
} from "./shared.js";

export const signupSchema = z.object({
  identifier: z.string().trim().min(3).max(320),
  password: passwordSchema,
  display_name: z.string().trim().min(1).max(120).optional(),
  client_id: z.string().trim().min(1).max(100),
  redirect_uri: z.string().url(),
});

export const loginSchema = z.object({
  identifier: z.string().trim().min(3).max(320),
  password: z.string().min(1).max(128),
  client_id: z.string().trim().min(1).max(100),
});

export const logoutSchema = z.object({
  global: z.boolean().default(false),
});

export const forgotPasswordSchema = z.object({
  identifier: z.string().trim().min(3).max(320),
  client_id: z.string().trim().min(1).max(100).optional(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1).optional(),
  challenge_id: z.string().uuid().optional(),
  code: z.string().trim().length(6).optional(),
  password: passwordSchema,
}).superRefine((value, ctx) => {
  if (!value.token && !(value.challenge_id && value.code)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide either a reset token or a challenge_id with code.",
    });
  }
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

export const signupVerifySchema = z.object({
  challenge_id: z.string().uuid(),
  code: z.string().trim().length(6),
});

export const resendVerificationSchema = z.object({
  challenge_id: z.string().uuid().optional(),
  identifier: z.string().trim().min(3).max(320).optional(),
}).superRefine((value, ctx) => {
  if (!value.challenge_id && !value.identifier) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide challenge_id or identifier.",
    });
  }
});

export const registerSchema = signupSchema;

/**
 * Editing your own profile.
 *
 * A display name is shown to the person themselves and, in shared contexts, to
 * others — so it is bounded. 120 characters is generous for real names
 * including scripts that need more code points per glyph, and short enough that
 * it cannot be used to push a wall of text through any surface that renders it.
 *
 * Nullable: clearing a display name is a legitimate choice, and is distinct
 * from omitting the field, which leaves it unchanged.
 */
export const updateProfileSchema = z.object({
  display_name: z.string().max(120).nullish(),
});

/** Asking to move an account to a new address. */
export const requestEmailChangeSchema = z.object({
  email: emailSchema,
});

/** Proving control of the new address. */
export const confirmEmailChangeSchema = z.object({
  challenge_id: z.string().uuid(),
  code: z.string().min(4).max(12),
});

/**
 * Setting or changing the account password from inside a signed-in session.
 *
 * ONE SCHEMA FOR BOTH, because they are the same act — an account gains a
 * password it can sign in with — and splitting them into two endpoints would
 * make the caller decide which case it is in from state it has to fetch first
 * and can race against. The SERVER knows whether a password already exists, so
 * the server decides what proof is required.
 *
 * `current_password` and `code` are BOTH optional here, and that is not the
 * check being skipped: what counts as sufficient proof depends on what this
 * account actually has, and a schema cannot see that. Requiring
 * `current_password` at this layer is precisely the bug that made
 * `POST /v1/mfa/disable` unreachable for Google and GitHub accounts — it
 * demanded a credential those accounts had never had, and answered "Incorrect
 * password" about a password that did not exist. The route re-authenticates.
 */
export const setPasswordSchema = z.object({
  new_password: passwordSchema,
  /** Proof for an account that already HAS a password. */
  current_password: z.string().min(1).max(128).optional(),
  /** An authenticator code or a recovery code, for an account with MFA on. */
  code: z.string().min(4).max(64).optional(),
});

/**
 * Closing an account.
 *
 * The typed confirmation is checked on the SERVER. A client-side "are you sure"
 * is a rendering choice that anything calling the API directly skips entirely,
 * and this is the one action with no undo.
 */
export const closeAccountSchema = z.object({
  confirm: z.literal("DELETE"),
});
