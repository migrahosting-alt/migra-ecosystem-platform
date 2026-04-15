import { z } from "zod";
import { urlSchema } from "./shared";

export const authorizeQuerySchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().trim().min(1).max(100),
  redirect_uri: urlSchema,
  state: z.string().min(1).max(512),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal("S256"),
  scope: z.string().trim().max(500).optional(),
  nonce: z.string().max(255).optional(),
  prompt: z.enum(["none", "login", "consent"]).optional(),
  login_hint: z.string().trim().max(255).optional(),
  return_to: urlSchema.optional(),
});

export const tokenExchangeSchema = z.object({
  grant_type: z.enum(["authorization_code", "refresh_token"]),
  code: z.string().min(1).optional(),
  code_verifier: z.string().optional(),
  redirect_uri: urlSchema.optional(),
  client_id: z.string().trim().min(1).max(100),
  client_secret: z.string().min(1).max(255).optional(),
  refresh_token: z.string().min(1).optional(),
}).superRefine((input, ctx) => {
  if (input.grant_type === "authorization_code") {
    if (!input.code) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "code is required", path: ["code"] });
    }
    if (!input.redirect_uri) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "redirect_uri is required", path: ["redirect_uri"] });
    }
  }

  if (input.grant_type === "refresh_token" && !input.refresh_token) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "refresh_token is required", path: ["refresh_token"] });
  }
});

export const revokeSchema = z.object({
  token: z.string().min(1),
  token_type_hint: z.enum(["refresh_token", "access_token"]).optional(),
});

export const tokenRequestSchema = tokenExchangeSchema;
export const revokeTokenSchema = revokeSchema;
