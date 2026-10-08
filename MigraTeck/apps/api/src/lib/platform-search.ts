import type { FastifyRequest } from "fastify";
import { getDb } from "./db.js";
import {
  listAuthPlatformOrganizations,
  listAuthPlatformUsers,
  type AuthPlatformOrganization,
  type AuthPlatformUser,
} from "./migraauth.js";

export type PlatformSearchKind =
  | "organization"
  | "identity_user"
  | "billing_customer";

export type PlatformSearchResult = {
  id: string;
  kind: PlatformSearchKind;
  title: string;
  subtitle: string;
  detail: string | null;
  href: string;
  source: "platform" | "migraauth" | "commerce";
};

export type PlatformSearchSourceState =
  | "ok"
  | "partial"
  | "unavailable"
  | "not_authorized";

type SearchAuthority = {
  permissions: string[];
};

type LocalOrganizationRow = {
  id: string;
  name: string;
  slug: string;
  authOrganizationId: string | null;
  isMigraHostingClient: boolean;
};

type BillingCustomerRow = {
  id: string;
  orgId: string;
  orgName: string;
  orgSlug: string;
  externalCustomerId: string;
  email: string | null;
  provider: string;
};

function target(path: string, query: string): string {
  const params = new URLSearchParams({ q: query });
  return path + "?" + params.toString();
}

function normalizedQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function searchText(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function exactOrPrefixScore(query: string, values: Array<string | null | undefined>): number {
  const q = query.toLowerCase();
  const normalized = values.map((value) => searchText(value).toLowerCase());
  if (normalized.some((value) => value === q)) return 0;
  if (normalized.some((value) => value.startsWith(q))) return 1;
  return 2;
}

async function searchLocalOrganizations(
  query: string,
  limit: number,
): Promise<LocalOrganizationRow[]> {
  const result = await getDb().query<LocalOrganizationRow>(
    `SELECT
       id,
       name,
       slug,
       "authOrganizationId",
       "isMigraHostingClient"
     FROM "Organization"
     WHERE
       position(lower($1) in lower(COALESCE(name,''))) > 0
       OR position(lower($1) in lower(COALESCE(slug,''))) > 0
       OR position(lower($1) in lower(COALESCE("authOrganizationId",''))) > 0
     ORDER BY
       CASE
         WHEN lower(name)=lower($1) OR lower(slug)=lower($1) THEN 0
         WHEN lower(name) LIKE lower($1) || '%' OR lower(slug) LIKE lower($1) || '%' THEN 1
         ELSE 2
       END,
       "updatedAt" DESC
     LIMIT $2`,
    [query, limit],
  );
  return result.rows;
}

async function searchBillingCustomers(
  query: string,
  limit: number,
): Promise<BillingCustomerRow[]> {
  const result = await getDb().query<BillingCustomerRow>(
    `SELECT
       c.id,
       c."orgId",
       o.name AS "orgName",
       o.slug AS "orgSlug",
       c."externalCustomerId",
       c.email,
       c.provider::text AS provider
     FROM "BillingCustomer" c
     JOIN "Organization" o ON o.id=c."orgId"
     WHERE
       position(lower($1) in lower(COALESCE(c."externalCustomerId",''))) > 0
       OR position(lower($1) in lower(COALESCE(c.email,''))) > 0
       OR position(lower($1) in lower(COALESCE(o.name,''))) > 0
       OR position(lower($1) in lower(COALESCE(o.slug,''))) > 0
     ORDER BY
       CASE
         WHEN lower(COALESCE(c."externalCustomerId",''))=lower($1)
           OR lower(COALESCE(c.email,''))=lower($1)
           OR lower(o.name)=lower($1)
           OR lower(o.slug)=lower($1)
         THEN 0
         ELSE 1
       END,
       c."updatedAt" DESC
     LIMIT $2`,
    [query, limit],
  );
  return result.rows;
}

function localOrganizationResult(row: LocalOrganizationRow, query: string): PlatformSearchResult {
  return {
    id: "platform-org:" + row.id,
    kind: "organization",
    title: row.name,
    subtitle: row.slug,
    detail: row.authOrganizationId
      ? "Platform tenant linked to MigraAuth"
      : "Platform tenant without MigraAuth linkage",
    href: target("/platform/organizations", query),
    source: "platform",
  };
}

function authOrganizationResult(
  row: AuthPlatformOrganization,
  query: string,
): PlatformSearchResult {
  return {
    id: "auth-org:" + row.id,
    kind: "organization",
    title: row.name,
    subtitle: row.slug,
    detail:
      String(row.active_member_count) +
      " active member" +
      (row.active_member_count === 1 ? "" : "s") +
      " · MigraAuth identity organization",
    href: target("/platform/organizations", query),
    source: "migraauth",
  };
}

function userResult(row: AuthPlatformUser, query: string): PlatformSearchResult {
  const title = row.display_name?.trim() || row.email?.trim() || row.id;
  return {
    id: "auth-user:" + row.id,
    kind: "identity_user",
    title,
    subtitle: row.email ?? row.id,
    detail: row.status + (row.last_login_at ? " · last login " + row.last_login_at : ""),
    href: target("/platform/trust", query),
    source: "migraauth",
  };
}

function billingResult(row: BillingCustomerRow, query: string): PlatformSearchResult {
  return {
    id: "billing-customer:" + row.id,
    kind: "billing_customer",
    title: row.orgName,
    subtitle: row.email ?? row.externalCustomerId,
    detail: row.provider + " · " + row.externalCustomerId,
    href: target("/platform/billing", query),
    source: "commerce",
  };
}

export async function searchPlatform(
  request: FastifyRequest,
  authority: SearchAuthority,
  rawQuery: string,
  limit: number,
) {
  const query = normalizedQuery(rawQuery);
  const permissions = new Set(authority.permissions);
  const perSourceLimit = Math.min(Math.max(limit, 1), 10);

  const canOrganizations = permissions.has("platform.organizations.read");
  const canUsers = permissions.has("platform.users.read");
  const canCommerce = permissions.has("platform.commerce.read");

  let localOrganizations: LocalOrganizationRow[] = [];
  let identityOrganizations: AuthPlatformOrganization[] = [];
  let users: AuthPlatformUser[] = [];
  let billingCustomers: BillingCustomerRow[] = [];

  let organizationSource: PlatformSearchSourceState = canOrganizations
    ? "ok"
    : "not_authorized";
  let userSource: PlatformSearchSourceState = canUsers
    ? "ok"
    : "not_authorized";
  let commerceSource: PlatformSearchSourceState = canCommerce
    ? "ok"
    : "not_authorized";

  if (canOrganizations) {
    const [local, identity] = await Promise.allSettled([
      searchLocalOrganizations(query, perSourceLimit),
      listAuthPlatformOrganizations(request, {
        q: query,
        limit: perSourceLimit,
        offset: 0,
      }),
    ]);

    if (local.status === "fulfilled") {
      localOrganizations = local.value;
    }
    if (identity.status === "fulfilled") {
      identityOrganizations = identity.value.organizations;
    }

    const failed = Number(local.status === "rejected") + Number(identity.status === "rejected");
    organizationSource =
      failed === 0 ? "ok" : failed === 1 ? "partial" : "unavailable";
  }

  if (canUsers) {
    try {
      const result = await listAuthPlatformUsers(request, {
        q: query,
        limit: perSourceLimit,
        offset: 0,
      });
      users = result.users;
    } catch {
      userSource = "unavailable";
    }
  }

  if (canCommerce) {
    try {
      billingCustomers = await searchBillingCustomers(query, perSourceLimit);
    } catch {
      commerceSource = "unavailable";
    }
  }

  const linkedIdentityIds = new Set(
    localOrganizations
      .map((row) => row.authOrganizationId)
      .filter((value): value is string => Boolean(value)),
  );
  const linkedSlugs = new Set(
    localOrganizations.map((row) => row.slug.toLowerCase()),
  );

  const organizationResults = [
    ...localOrganizations.map((row) => localOrganizationResult(row, query)),
    ...identityOrganizations
      .filter(
        (row) =>
          !linkedIdentityIds.has(row.id) &&
          !linkedSlugs.has(row.slug.toLowerCase()),
      )
      .map((row) => authOrganizationResult(row, query)),
  ]
    .sort((a, b) => {
      const aScore = exactOrPrefixScore(query, [a.title, a.subtitle]);
      const bScore = exactOrPrefixScore(query, [b.title, b.subtitle]);
      return aScore - bScore || a.title.localeCompare(b.title);
    })
    .slice(0, perSourceLimit);

  const userResults = users
    .map((row) => userResult(row, query))
    .sort((a, b) => {
      const aScore = exactOrPrefixScore(query, [a.title, a.subtitle]);
      const bScore = exactOrPrefixScore(query, [b.title, b.subtitle]);
      return aScore - bScore || a.title.localeCompare(b.title);
    })
    .slice(0, perSourceLimit);

  const commerceResults = billingCustomers
    .map((row) => billingResult(row, query))
    .slice(0, perSourceLimit);

  return {
    query,
    operator: true,
    sources: {
      organizations: organizationSource,
      users: userSource,
      commerce: commerceSource,
    },
    results: [
      ...organizationResults,
      ...userResults,
      ...commerceResults,
    ],
  };
}
