/**
 * OAuth Clients module — client registration and validation.
 */
import { db } from "../../lib/db.js";
import { generateToken, hashToken, verifyTokenHash } from "../../lib/crypto.js";
import { nanoid } from "nanoid";
import type { MemberRole, OAuthClient } from "../../prisma-client.js";

export type { OAuthClient };

export interface OAuthClientOwnerMembership {
  organizationId: string;
  role: MemberRole;
}

export interface DeveloperOAuthClientInput {
  clientName: string;
  description?: string;
  clientType: string;
  redirectUris: string[];
  postLogoutRedirectUris?: string[];
  allowedScopes: string[];
  requiresPkce?: boolean;
  tokenAuthMethod?: string;
  ownerUserId?: string | null;
  ownerOrganizationId?: string | null;
}

export async function findClientById(
  clientId: string,
): Promise<OAuthClient | null> {
  return db.oAuthClient.findUnique({ where: { clientId } });
}

export async function listVisibleClientsForUser(userId: string) {
  const memberships = await db.organizationMember.findMany({
    where: { userId, status: "ACTIVE" },
    select: { organizationId: true, role: true },
  });

  const orgIds = memberships.map((membership) => membership.organizationId);
  const clients = await db.oAuthClient.findMany({
    where: {
      OR: [
        { ownerUserId: userId },
        ...(orgIds.length > 0 ? [{ ownerOrganizationId: { in: orgIds } }] : []),
      ],
    },
    include: {
      ownerOrganization: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  return { clients, memberships };
}

export async function findVisibleClientForUser(userId: string, clientId: string) {
  const { clients, memberships } = await listVisibleClientsForUser(userId);
  return {
    client: clients.find((entry) => entry.clientId === clientId) ?? null,
    memberships,
  };
}

export function canManageClient(
  client: Pick<OAuthClient, "ownerUserId" | "ownerOrganizationId">,
  userId: string,
  memberships: OAuthClientOwnerMembership[],
): boolean {
  if (client.ownerUserId === userId) {
    return true;
  }

  if (!client.ownerOrganizationId) {
    return false;
  }

  return memberships.some(
    (membership) =>
      membership.organizationId === client.ownerOrganizationId
      && (membership.role === "OWNER" || membership.role === "ADMIN"),
  );
}

function slugifyName(name: string): string {
  const normalized = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.slice(0, 32) || "client";
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function normalizeClientInput(input: DeveloperOAuthClientInput) {
  return {
    clientName: input.clientName.trim(),
    description: input.description?.trim() || null,
    clientType: input.clientType,
    redirectUris: uniqueStrings(input.redirectUris),
    postLogoutRedirectUris: uniqueStrings(input.postLogoutRedirectUris ?? []),
    allowedScopes: uniqueStrings(input.allowedScopes),
    requiresPkce: input.requiresPkce ?? true,
    tokenAuthMethod: input.tokenAuthMethod ?? "none",
    ownerUserId: input.ownerUserId ?? null,
    ownerOrganizationId: input.ownerOrganizationId ?? null,
  };
}

export function issueClientSecret() {
  const clientSecret = generateToken(36);
  return {
    clientSecret,
    clientSecretHash: hashToken(clientSecret),
  };
}

export async function createDeveloperClient(input: DeveloperOAuthClientInput) {
  const normalized = normalizeClientInput(input);
  const clientId = `${slugifyName(normalized.clientName)}_${nanoid(10)}`;
  const secretBundle = normalized.tokenAuthMethod === "none"
    ? null
    : issueClientSecret();

  const client = await db.oAuthClient.create({
    data: {
      clientId,
      clientName: normalized.clientName,
      description: normalized.description,
      clientType: normalized.clientType,
      redirectUris: normalized.redirectUris,
      postLogoutRedirectUris: normalized.postLogoutRedirectUris,
      allowedScopes: normalized.allowedScopes,
      requiresPkce: normalized.requiresPkce,
      tokenAuthMethod: normalized.tokenAuthMethod,
      clientSecretHash: secretBundle?.clientSecretHash ?? null,
      isFirstParty: false,
      isActive: true,
      ownerUserId: normalized.ownerUserId,
      ownerOrganizationId: normalized.ownerOrganizationId,
    },
    include: {
      ownerOrganization: true,
    },
  });

  return {
    client,
    clientSecret: secretBundle?.clientSecret,
  };
}

export async function updateDeveloperClient(
  clientId: string,
  input: Partial<DeveloperOAuthClientInput> & { isActive?: boolean },
) {
  const data: Record<string, unknown> = {};

  if (input.clientName !== undefined) data.clientName = input.clientName.trim();
  if (input.description !== undefined) data.description = input.description?.trim() || null;
  if (input.redirectUris !== undefined) data.redirectUris = uniqueStrings(input.redirectUris);
  if (input.postLogoutRedirectUris !== undefined) {
    data.postLogoutRedirectUris = uniqueStrings(input.postLogoutRedirectUris);
  }
  if (input.allowedScopes !== undefined) data.allowedScopes = uniqueStrings(input.allowedScopes);
  if (input.requiresPkce !== undefined) data.requiresPkce = input.requiresPkce;
  if (input.isActive !== undefined) data.isActive = input.isActive;

  return db.oAuthClient.update({
    where: { clientId },
    data,
    include: {
      ownerOrganization: true,
    },
  });
}

export async function rotateDeveloperClientSecret(clientId: string) {
  const secretBundle = issueClientSecret();
  const client = await db.oAuthClient.update({
    where: { clientId },
    data: {
      clientSecretHash: secretBundle.clientSecretHash,
      tokenAuthMethod: "client_secret_basic",
    },
    include: {
      ownerOrganization: true,
    },
  });

  return {
    client,
    clientSecret: secretBundle.clientSecret,
  };
}

export async function deactivateDeveloperClient(clientId: string) {
  return db.oAuthClient.update({
    where: { clientId },
    data: { isActive: false },
    include: {
      ownerOrganization: true,
    },
  });
}

export function isConfidentialClient(client: Pick<OAuthClient, "tokenAuthMethod">): boolean {
  return client.tokenAuthMethod !== "none";
}

export function verifyRegisteredClientSecret(client: Pick<OAuthClient, "clientSecretHash">, secret?: string | null): boolean {
  if (!client.clientSecretHash || !secret) {
    return false;
  }

  return verifyTokenHash(secret, client.clientSecretHash);
}

export function validateRedirectUri(
  client: OAuthClient,
  redirectUri: string,
): boolean {
  const uris = client.redirectUris as string[];
  return uris.includes(redirectUri);
}

export function validatePostLogoutUri(
  client: OAuthClient,
  uri: string,
): boolean {
  const uris = client.postLogoutRedirectUris as string[];
  return uris.includes(uri);
}

export function validateScopes(
  client: OAuthClient,
  requestedScopes: string[],
): string[] {
  const allowed = new Set(client.allowedScopes as string[]);
  return requestedScopes.filter((s) => allowed.has(s));
}
