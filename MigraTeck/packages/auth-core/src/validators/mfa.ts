import { z } from "zod";
import { uuidSchema } from "./shared";

export const enrollTotpSchema = z.object({});

export const verifyTotpSchema = z.object({
  challenge_id: uuidSchema.optional(),
  code: z.string().regex(/^\d{6}$/),
});

export const mfaDisableSchema = z.object({
  password: z.string().min(1).max(128),
});

export const deleteMfaMethodSchema = mfaDisableSchema;
