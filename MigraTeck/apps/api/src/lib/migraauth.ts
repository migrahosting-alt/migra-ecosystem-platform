import type { FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";

type AuthUser = {
  id: string;
  email: string | null;
  display_name?: string;
  status: string;
};

type AuthMembership = {
  id: string;
  name: string;
  slug: string;
  role: string;
  joined_at: string;
};

type MeResponse = {
  authenticated: true;
  user: AuthUser;
};

type OrganizationsResponse = {
  organizations: AuthMembership[];
};

type PlatformAuthorityResponse = {
  user_id: string;
  email: string | null;
  roles: string[];
  permissions: string[];
  via_bootstrap: boolean;
};

export type AuthPlatformOrganization = {
  id: string;
  name: string;
  slug: string;
  owner_user_id: string;
  owner: {
    id: string;
    email: string | null;
    display_name: string | null;
    status: string;
    last_login_at: string | null;
  };
  member_count: number;
  active_member_count: number;
  owner_count: number;
  oauth_client_count: number;
  created_at: string;
  updated_at: string;
};

type PlatformOrganizationsResponse = {
  organizations: AuthPlatformOrganization[];
  total: number;
  limit: number;
  offset: number;
};

export type AuthPlatformUser = {
  id: string;
  email: string | null;
  status: string;
  email_verified: boolean;
  display_name: string | null;
  created_at: string;
  last_login_at: string | null;
};

type PlatformUsersResponse = {
  users: AuthPlatformUser[];
  total: number;
  limit: number;
  offset: number;
};

type CreatePlatformOrganizationResponse = {
  organization: AuthPlatformOrganization;
};

export type PlatformAuthorityPrincipal = {
  authUser: AuthUser;
  platformUserId: string;
  roles: string[];
  permissions: string[];
  viaBootstrap: boolean;
};

export type PlatformPrincipal = {
  authUser: AuthUser;
  membership: AuthMembership;
  platformUserId: string;
  platformOrgId: string;
};

export type PlatformIdentityDiagnostic = {
  authenticated: true;
  strategy: "migraauth-oauth2-bearer";
  user: {
    id: string;
    email: string | null;
    displayName: string | null;
    status: string;
  };
  memberships: AuthMembership[];
  selectedOrganization: AuthMembership | null;
  platformOperator: {
    authorized: boolean;
    roles: string[];
    permissions: string[];
    viaBootstrap: boolean;
  };
  bridge: {
    user: {
      status: "linked" | "email_candidate" | "missing";
      platformUserId: string | null;
    };
    organization: {
      status: "linked" | "slug_candidate" | "missing" | "not_selected";
      platformOrganizationId: string | null;
      authOrganizationId: string | null;
    };
  };
};

function authBaseUrl(): string {
  return (
    process.env.MIGRAAUTH_API_URL ??
    process.env.MIGRAAUTH_BASE_URL ??
    process.env.AUTH_API_URL ??
    "http://127.0.0.1:4120"
  ).replace(/\/+$/, "");
}

function bearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw Object.assign(new Error("Authentication required"), { statusCode: 401 });
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    throw Object.assign(new Error("Authentication required"), { statusCode: 401 });
  }

  return token;
}

async function authFetch<T>(path: string, token: string): Promise<T> {
  const response = await fetch(authBaseUrl() + path, {
    headers: { Authorization: "Bearer " + token },
    signal: AbortSignal.timeout(5_000),
  });

  if (response.status === 401) {
    throw Object.assign(new Error("MigraAuth session is invalid or expired"), { statusCode: 401 });
  }
  if (!response.ok) {
    throw Object.assign(new Error("Identity authority is temporarily unavailable"), {
      statusCode: 503,
    });
  }

  return response.json() as Promise<T>;
}

async function authFetchPlatformAuthority(
  token: string,
): Promise<PlatformAuthorityResponse> {
  const response = await fetch(authBaseUrl() + "/v1/admin/me", {
    headers: { Authorization: "Bearer " + token },
    signal: AbortSignal.timeout(5_000),
  });

  if (response.status === 401) {
    throw Object.assign(new Error("MigraAuth session is invalid or expired"), {
      statusCode: 401,
    });
  }
  if (response.status === 404 || response.status === 403) {
    throw Object.assign(new Error("Platform operator authority is required"), {
      statusCode: 403,
    });
  }
  if (!response.ok) {
    throw Object.assign(new Error("Identity authority is temporarily unavailable"), {
      statusCode: 503,
    });
  }

  return response.json() as Promise<PlatformAuthorityResponse>;
}

function errorStatus(error: unknown): number | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof (error as { statusCode?: unknown }).statusCode === "number"
  ) {
    return (error as { statusCode: number }).statusCode;
  }
  return null;
}

export async function getPlatformIdentityDiagnostic(
  request: FastifyRequest,
  requestedOrganizationId?: string | null,
): Promise<PlatformIdentityDiagnostic> {
  const token = bearerToken(request);
  const [me, organizations] = await Promise.all([
    authFetch<MeResponse>("/v1/me", token),
    authFetch<OrganizationsResponse>("/v1/organizations", token),
  ]);

  let authority: PlatformAuthorityResponse | null = null;
  try {
    authority = await authFetchPlatformAuthority(token);
  } catch (error) {
    if (errorStatus(error) !== 403) throw error;
  }

  if (authority && authority.user_id !== me.user.id) {
    throw Object.assign(
      new Error("Identity authority returned inconsistent operator identity"),
      { statusCode: 503 },
    );
  }

  const requested = requestedOrganizationId?.trim() || null;
  let selectedOrganization: AuthMembership | null = null;
  if (requested) {
    selectedOrganization =
      organizations.organizations.find((membership) => membership.id === requested) ??
      null;
    if (!selectedOrganization) {
      throw Object.assign(
        new Error("Requested organization is not part of this authenticated identity"),
        { statusCode: 403 },
      );
    }
  } else if (organizations.organizations.length === 1) {
    selectedOrganization = organizations.organizations[0] ?? null;
  }

  const db = getDb();
  const userBridge = me.user.email
    ? await db.query<{ id: string; authUserId: string | null }>(
        'SELECT id,"authUserId" FROM "User" WHERE "authUserId"=$1 OR lower(email)=lower($2) ORDER BY CASE WHEN "authUserId"=$1 THEN 0 ELSE 1 END LIMIT 1',
        [me.user.id, me.user.email],
      )
    : await db.query<{ id: string; authUserId: string | null }>(
        'SELECT id,"authUserId" FROM "User" WHERE "authUserId"=$1 LIMIT 1',
        [me.user.id],
      );
  const userRow = userBridge.rows[0] ?? null;
  const userBridgeStatus: "linked" | "email_candidate" | "missing" =
    !userRow
      ? "missing"
      : userRow.authUserId === me.user.id
        ? "linked"
        : "email_candidate";

  let organizationBridge: PlatformIdentityDiagnostic["bridge"]["organization"] = {
    status: "not_selected",
    platformOrganizationId: null,
    authOrganizationId: null,
  };

  if (selectedOrganization) {
    const orgResult = await db.query<{
      id: string;
      authOrganizationId: string | null;
    }>(
      'SELECT id,"authOrganizationId" FROM "Organization" WHERE "authOrganizationId"=$1 OR slug=$2 ORDER BY CASE WHEN "authOrganizationId"=$1 THEN 0 ELSE 1 END LIMIT 1',
      [selectedOrganization.id, selectedOrganization.slug],
    );
    const orgRow = orgResult.rows[0] ?? null;
    organizationBridge = !orgRow
      ? {
          status: "missing",
          platformOrganizationId: null,
          authOrganizationId: null,
        }
      : {
          status:
            orgRow.authOrganizationId === selectedOrganization.id
              ? "linked"
              : "slug_candidate",
          platformOrganizationId: orgRow.id,
          authOrganizationId: orgRow.authOrganizationId,
        };
  }

  return {
    authenticated: true,
    strategy: "migraauth-oauth2-bearer",
    user: {
      id: me.user.id,
      email: me.user.email,
      displayName: me.user.display_name ?? null,
      status: me.user.status,
    },
    memberships: organizations.organizations,
    selectedOrganization,
    platformOperator: {
      authorized: Boolean(authority),
      roles: authority?.roles ?? [],
      permissions: authority?.permissions ?? [],
      viaBootstrap: authority?.via_bootstrap ?? false,
    },
    bridge: {
      user: {
        status: userBridgeStatus,
        platformUserId: userRow?.id ?? null,
      },
      organization: organizationBridge,
    },
  };
}

async function ensurePlatformUser(user: AuthUser): Promise<string> {
  if (!user.email) {
    throw Object.assign(new Error("A verified email identity is required for platform access"), {
      statusCode: 403,
    });
  }

  const db = getDb();
  const existing = await db.query<{ id: string }>(
    'SELECT id FROM "User" WHERE "authUserId" = $1 OR lower(email) = lower($2) ORDER BY CASE WHEN "authUserId" = $1 THEN 0 ELSE 1 END LIMIT 1',
    [user.id, user.email],
  );

  if (existing.rows[0]) {
    await db.query(
      'UPDATE "User" SET "authUserId" = $1, "emailNormalized" = lower($2), name = COALESCE($3, name), "updatedAt" = NOW() WHERE id = $4',
      [user.id, user.email, user.display_name ?? null, existing.rows[0].id],
    );
    return existing.rows[0].id;
  }

  const id = randomUUID();
  await db.query(
    'INSERT INTO "User" (id, "authUserId", name, email, "emailNormalized", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, lower($4), NOW(), NOW())',
    [id, user.id, user.display_name ?? null, user.email],
  );
  return id;
}

async function ensurePlatformOrganization(
  membership: AuthMembership,
  createdById: string,
): Promise<string> {
  const db = getDb();
  const existing = await db.query<{ id: string }>(
    'SELECT id FROM "Organization" WHERE "authOrganizationId" = $1 OR slug = $2 ORDER BY CASE WHEN "authOrganizationId" = $1 THEN 0 ELSE 1 END LIMIT 1',
    [membership.id, membership.slug],
  );

  if (existing.rows[0]) {
    await db.query(
      'UPDATE "Organization" SET "authOrganizationId" = $1, name = $2, "updatedAt" = NOW() WHERE id = $3',
      [membership.id, membership.name, existing.rows[0].id],
    );
    return existing.rows[0].id;
  }

  const id = randomUUID();
  await db.query(
    'INSERT INTO "Organization" (id, "authOrganizationId", name, slug, "createdById", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, NOW(), NOW())',
    [id, membership.id, membership.name, membership.slug, createdById],
  );
  return id;
}

export async function requirePlatformAuthority(
  request: FastifyRequest,
  requiredPermissions: readonly string[] = ["platform.commerce.read"],
): Promise<PlatformAuthorityPrincipal> {
  const token = bearerToken(request);
  const [me, authority] = await Promise.all([
    authFetch<MeResponse>("/v1/me", token),
    authFetchPlatformAuthority(token),
  ]);

  if (authority.user_id !== me.user.id) {
    throw Object.assign(new Error("Identity authority returned inconsistent operator identity"), {
      statusCode: 503,
    });
  }

  const held = new Set(authority.permissions);
  const missing = requiredPermissions.filter((permission) => !held.has(permission));
  if (missing.length > 0) {
    throw Object.assign(
      new Error("Platform operator is missing required permission: " + missing.join(", ")),
      { statusCode: 403 },
    );
  }

  const platformUserId = await ensurePlatformUser(me.user);
  return {
    authUser: me.user,
    platformUserId,
    roles: authority.roles,
    permissions: authority.permissions,
    viaBootstrap: authority.via_bootstrap,
  };
}

export async function listAuthPlatformOrganizations(
  request: FastifyRequest,
  input: { q?: string; limit?: number; offset?: number } = {},
): Promise<PlatformOrganizationsResponse> {
  const token = bearerToken(request);
  const params = new URLSearchParams();
  if (input.q?.trim()) params.set("q", input.q.trim());
  if (input.limit !== undefined) params.set("limit", String(input.limit));
  if (input.offset !== undefined) params.set("offset", String(input.offset));

  const response = await fetch(
    authBaseUrl() +
      "/v1/admin/organizations" +
      (params.size ? "?" + params.toString() : ""),
    {
      headers: { Authorization: "Bearer " + token },
      signal: AbortSignal.timeout(5_000),
    },
  );

  if (response.status === 401) {
    throw Object.assign(new Error("MigraAuth session is invalid or expired"), {
      statusCode: 401,
    });
  }
  if (response.status === 403) {
    throw Object.assign(
      new Error("Platform organization directory authority is required"),
      { statusCode: 403 },
    );
  }
  if (!response.ok) {
    throw Object.assign(new Error("Identity organization directory is temporarily unavailable"), {
      statusCode: 503,
    });
  }

  return response.json() as Promise<PlatformOrganizationsResponse>;
}


export async function listAuthPlatformUsers(
  request: FastifyRequest,
  input: { q?: string; limit?: number; offset?: number } = {},
): Promise<PlatformUsersResponse> {
  const token = bearerToken(request);
  const params = new URLSearchParams();
  if (input.q?.trim()) params.set("q", input.q.trim());
  if (input.limit !== undefined) params.set("limit", String(input.limit));
  if (input.offset !== undefined) params.set("offset", String(input.offset));

  const response = await fetch(
    authBaseUrl() +
      "/v1/admin/users" +
      (params.size ? "?" + params.toString() : ""),
    {
      headers: { Authorization: "Bearer " + token },
      signal: AbortSignal.timeout(5_000),
    },
  );

  if (response.status === 401) {
    throw Object.assign(new Error("MigraAuth session is invalid or expired"), {
      statusCode: 401,
    });
  }
  if (response.status === 403) {
    throw Object.assign(
      new Error("Platform user-directory authority is required"),
      { statusCode: 403 },
    );
  }
  if (!response.ok) {
    throw Object.assign(
      new Error("Identity user directory is temporarily unavailable"),
      { statusCode: 503 },
    );
  }

  return response.json() as Promise<PlatformUsersResponse>;
}

export async function createAuthPlatformOrganization(
  request: FastifyRequest,
  input: { name: string; slug: string; ownerUserId: string },
): Promise<AuthPlatformOrganization> {
  const token = bearerToken(request);
  const response = await fetch(authBaseUrl() + "/v1/admin/organizations", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: input.name,
      slug: input.slug,
      owner_user_id: input.ownerUserId,
    }),
    signal: AbortSignal.timeout(5_000),
  });

  const body = await response.json().catch(() => null) as
    | CreatePlatformOrganizationResponse
    | { error?: { code?: string; message?: string }; message?: string }
    | null;

  if (response.status === 401) {
    throw Object.assign(new Error("MigraAuth session is invalid or expired"), {
      statusCode: 401,
    });
  }
  if (response.status === 403) {
    throw Object.assign(
      new Error("Platform organization-management authority is required"),
      { statusCode: 403 },
    );
  }
  if (!response.ok) {
    const message =
      body && "error" in body
        ? body.error?.message
        : body && "message" in body
          ? body.message
          : null;
    throw Object.assign(
      new Error(
        message ??
          (response.status >= 500
            ? "Identity organization creation is temporarily unavailable"
            : "Identity organization could not be created"),
      ),
      {
        statusCode:
          response.status >= 400 && response.status < 500
            ? response.status
            : 503,
      },
    );
  }

  if (!body || !("organization" in body) || !body.organization) {
    throw Object.assign(
      new Error("Identity authority returned an invalid organization response"),
      { statusCode: 503 },
    );
  }

  return body.organization;
}

export async function requireOrganizationPrincipal(
  request: FastifyRequest,
  allowedRoles: readonly string[] = ["OWNER", "ADMIN"],
): Promise<PlatformPrincipal> {
  const token = bearerToken(request);
  const requestedOrgId = request.headers["x-org-id"];

  if (typeof requestedOrgId !== "string" || !requestedOrgId.trim()) {
    throw Object.assign(new Error("Missing x-org-id header"), { statusCode: 400 });
  }

  const [me, organizations] = await Promise.all([
    authFetch<MeResponse>("/v1/me", token),
    authFetch<OrganizationsResponse>("/v1/organizations", token),
  ]);

  const membership = organizations.organizations.find((org) => org.id === requestedOrgId);
  if (!membership) {
    throw Object.assign(new Error("You do not have access to this organization"), {
      statusCode: 403,
    });
  }

  const role = membership.role.toUpperCase();
  if (!allowedRoles.includes(role)) {
    throw Object.assign(
      new Error("This action requires one of: " + allowedRoles.join(", ")),
      { statusCode: 403 },
    );
  }

  const platformUserId = await ensurePlatformUser(me.user);
  const platformOrgId = await ensurePlatformOrganization(membership, platformUserId);

  return {
    authUser: me.user,
    membership,
    platformUserId,
    platformOrgId,
  };
}
