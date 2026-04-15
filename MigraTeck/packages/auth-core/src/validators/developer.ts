import { z } from "zod";
import {
  uuidSchema,
  urlSchema,
} from "./shared.js";

const developerClientTypeSchema = z.enum(["web", "spa", "native", "service"]);
const developerTokenAuthMethodSchema = z.enum(["none", "client_secret_basic", "client_secret_post"]);
const scopeArraySchema = z.array(z.string().trim().min(1).max(80)).min(1).max(50);

export const oauthClientIdSchema = z.object({
  clientId: z.string().trim().min(1).max(100),
});

export const createOAuthClientSchema = z.object({
  client_name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  client_type: developerClientTypeSchema,
  redirect_uris: z.array(urlSchema).min(1).max(25),
  post_logout_redirect_uris: z.array(urlSchema).max(25).optional(),
  allowed_scopes: scopeArraySchema,
  requires_pkce: z.boolean().optional(),
  token_auth_method: developerTokenAuthMethodSchema.optional(),
  owner_org_id: uuidSchema.optional(),
});

export const updateOAuthClientSchema = z.object({
  client_name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  redirect_uris: z.array(urlSchema).min(1).max(25).optional(),
  post_logout_redirect_uris: z.array(urlSchema).max(25).optional(),
  allowed_scopes: scopeArraySchema.optional(),
  requires_pkce: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

export const rotateClientSecretSchema = z.object({});
