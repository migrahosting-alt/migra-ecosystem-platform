import { z } from "zod";

export const cuidSchema = z.string().cuid();
export const uuidSchema = z.string().uuid();
export const isoDateStringSchema = z.string().datetime({ offset: true });
export const emailSchema = z.string().trim().email().max(320);
export const passwordSchema = z.string().min(10).max(128);
export const optionalPasswordSchema = z.string().min(1).max(128).optional();
export const localeSchema = z.string().trim().min(2).max(12).optional();
export const timezoneSchema = z.string().trim().min(2).max(64).optional();
export const urlSchema = z.string().url();
export const nullableUrlSchema = z.string().url().nullable().optional();
export const reasonSchema = z.string().trim().min(3).max(500);
export const pageLimitSchema = z.coerce.number().int().min(1).max(200).default(25);
export const pageOffsetSchema = z.coerce.number().int().min(0).default(0);
export const stringArraySchema = z.array(z.string().trim().min(1).max(255)).min(1);
export const optionalStringArraySchema = z.array(z.string().trim().min(1).max(255)).optional();

export const orgRoleSchema = z.enum([
  "OWNER",
  "ADMIN",
  "EDITOR",
  "BILLING",
  "SUPPORT",
  "MEMBER",
  "VIEWER",
]);

export const platformRoleSchema = z.enum([
  "PLATFORM_OWNER",
  "PLATFORM_ADMIN",
  "PLATFORM_SUPPORT",
  "PLATFORM_SECURITY_ANALYST",
]);

export const userStatusSchema = z.enum([
  "ACTIVE",
  "PENDING_VERIFICATION",
  "LOCKED",
  "DISABLED",
]);

export const oauthClientTypeSchema = z.enum(["FIRST_PARTY", "THIRD_PARTY", "INTERNAL_SERVICE"]);
export const oauthOwnershipTypeSchema = z.enum(["USER", "ORG", "PLATFORM"]);
export const securityEventResolutionSchema = z.enum(["RESOLVED", "IGNORED"]);