import { z } from "zod";
import {
  emailSchema,
  passwordSchema,
} from "./shared.js";

export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  display_name: z.string().trim().min(1).max(120).optional(),
  client_id: z.string().trim().min(1).max(100),
  redirect_uri: z.string().url(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
  client_id: z.string().trim().min(1).max(100),
});

export const logoutSchema = z.object({
  global: z.boolean().default(false),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
  client_id: z.string().trim().min(1).max(100).optional(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

export const resendVerificationSchema = z.object({
  email: emailSchema,
});

export const registerSchema = signupSchema;
