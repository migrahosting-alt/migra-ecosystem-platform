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
