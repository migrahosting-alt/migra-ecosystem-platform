import { z } from "zod";
import { emailSchema, uuidSchema } from "./shared.js";

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(1).max(120),
});

export const addMemberSchema = z.object({
  email: emailSchema,
  role: z.enum(["admin", "billing_admin", "member"]),
});

export const orgIdSchema = z.object({
  org_id: uuidSchema,
});

export const orgMemberIdSchema = z.object({
  org_id: uuidSchema,
  member_id: uuidSchema,
});

export const updateOrganizationMemberRoleSchema = z.object({
  role: z.enum(["admin", "billing_admin", "member"]),
});

export const addOrganizationMemberSchema = addMemberSchema;
