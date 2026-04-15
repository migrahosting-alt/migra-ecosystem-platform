import { z } from "zod";
import {
  pageLimitSchema,
  pageOffsetSchema,
  reasonSchema,
  uuidSchema,
} from "./shared";

export const adminUserIdSchema = z.object({
  id: uuidSchema,
});

export const adminUserListQuerySchema = z.object({
  q: z.string().trim().max(255).optional(),
  status: z.enum(["PENDING", "ACTIVE", "LOCKED", "DISABLED"]).optional(),
  limit: pageLimitSchema,
  offset: pageOffsetSchema,
});

export const adminActionSchema = z.object({
  reason: reasonSchema,
});

export const adminClientListQuerySchema = z.object({
  q: z.string().trim().max(255).optional(),
  is_active: z.enum(["true", "false"]).optional(),
  limit: pageLimitSchema,
  offset: pageOffsetSchema,
});

export const adminAuditQuerySchema = z.object({
  user_id: uuidSchema.optional(),
  event_type: z.string().trim().max(80).optional(),
  client_id: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: pageOffsetSchema,
});

export const adminUserSearchSchema = adminUserListQuerySchema;
export const adminActionReasonSchema = adminActionSchema;
export const adminClientSearchSchema = adminClientListQuerySchema;
export const adminAuditSearchSchema = adminAuditQuerySchema;
