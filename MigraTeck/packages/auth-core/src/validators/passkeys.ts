import { z } from "zod";
import { cuidSchema } from "./shared.js";

export const passkeyRegisterOptionsSchema = z.object({
  nickname: z.string().trim().min(1).max(120).optional(),
});

export const passkeyRegisterVerifySchema = z.object({
  challenge_id: cuidSchema,
  credential: z.record(z.string(), z.unknown()),
  nickname: z.string().trim().min(1).max(120).optional(),
});

export const passkeyAuthenticateOptionsSchema = z.object({
  email: z.string().trim().email().max(320).optional(),
});

export const passkeyAuthenticateVerifySchema = z.object({
  challenge_id: cuidSchema,
  credential: z.record(z.string(), z.unknown()),
  device_name: z.string().trim().min(1).max(120).optional(),
});

export const renamePasskeySchema = z.object({
  nickname: z.string().trim().min(1).max(120),
});

export const removePasskeySchema = z.object({
  passkey_id: cuidSchema,
});
