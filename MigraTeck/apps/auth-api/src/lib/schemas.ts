/**
 * Zod validation schemas for MigraAuth API inputs.
 * Aligned to openapi.yaml contract.
 */
import { z } from "zod";

// ── Account ─────────────────────────────────────────────────────────

export const signupSchema = z.object({
  email: z.string().email().max(255).toLowerCase().trim(),
  password: z
    .string()
    .min(10, "Password must be at least 10 characters")
    .max(128, "Password must be at most 128 characters"),
  display_name: z.string().max(120).optional(),
  client_id: z.string().min(1).max(100),
  redirect_uri: z.string().url(),
});

export const loginSchema = z.object({
  email: z.string().email().max(255).toLowerCase().trim(),
  password: z.string().min(1).max(128),
  client_id: z.string().min(1).max(100),
});

export const logoutSchema = z.object({
  global: z.boolean().default(false),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email().max(255).toLowerCase().trim(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z
    .string()
    .min(10, "Password must be at least 10 characters")
    .max(128),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

export const resendVerificationSchema = z.object({
  email: z.string().email().max(255).toLowerCase().trim(),
});

// ── OAuth / PKCE ────────────────────────────────────────────────────

export const authorizeQuerySchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1).max(100),
  redirect_uri: z.string().url(),
  state: z.string().min(1).max(512),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal("S256"),
  scope: z.string().max(500).optional(),
  nonce: z.string().max(256).optional(),
  prompt: z.enum(["none", "login", "consent"]).optional(),
  login_hint: z.string().max(255).optional(),
  return_to: z.string().url().optional(),
});

export const tokenExchangeSchema = z.object({
  grant_type: z.enum(["authorization_code", "refresh_token"]),
  code: z.string().optional(),
  code_verifier: z.string().optional(),
  redirect_uri: z.string().url().optional(),
  client_id: z.string().min(1).max(100),
  refresh_token: z.string().optional(),
});

export const revokeSchema = z.object({
  token: z.string().min(1),
  token_type_hint: z.enum(["refresh_token", "access_token"]).optional(),
});

// ── MFA ─────────────────────────────────────────────────────────────

export const totpVerifySchema = z.object({
  code: z.string().length(6).regex(/^\d{6}$/),
  challenge_id: z.string().uuid().optional(),
});

export const mfaDisableSchema = z.object({
  password: z.string().min(1),
});

// ── Sessions ────────────────────────────────────────────────────────

export const sessionIdSchema = z.object({
  id: z.string().uuid(),
});

// ── Organizations ───────────────────────────────────────────────────

export const createOrganizationSchema = z.object({
  name: z.string().min(1).max(160),
  slug: z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});

export const addMemberSchema = z.object({
  email: z.string().email().max(255).toLowerCase().trim(),
  role: z.enum(["admin", "billing_admin", "member"]),
});

export const orgIdSchema = z.object({
  org_id: z.string().uuid(),
});

// ── Admin ───────────────────────────────────────────────────────────

export const adminUserIdSchema = z.object({
  id: z.string().uuid(),
});

export const adminActionSchema = z.object({
  reason: z.string().min(1).max(500),
});
