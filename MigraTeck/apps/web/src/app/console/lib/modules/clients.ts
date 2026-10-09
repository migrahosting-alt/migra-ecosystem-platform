import { panelQuery, isPanelDbConfigured } from "../db";

/**
 * WHO COUNTS AS A CLIENT — one definition, used by every surface.
 *
 * Overview's "Clients" card counted `tenants WHERE COALESCE(is_active, TRUE)`,
 * which is every tenant row that has not been switched off: internal tenants,
 * the premium test account and any partner or system tenant included. That is a
 * database row count presented as a commercial fact.
 *
 * `tenant_type` is the column that separates them, and it defaults to CLIENT,
 * so this predicate only excludes rows somebody explicitly typed as something
 * else. It cannot silently drop a real customer.
 *
 * Exported so the Overview card and the client inventory read the SAME rule —
 * the pattern that stopped the open-ticket count and the support queue from
 * disagreeing. If this definition changes, it changes in one place.
 */
export const COMMERCIAL_CLIENT_PREDICATE =
  `COALESCE(tenant_type, 'CLIENT') = 'CLIENT' AND COALESCE(is_active, TRUE) = TRUE`;

export const COMMERCIAL_CLIENT_SOURCE =
  "panel DB · tenants where tenant_type = CLIENT and is_active (internal/test tenants excluded)";

export interface CommercialClientCount {
  /** null means not measured — render an em dash, never 0. */
  count: number | null;
  /** How many tenant rows were excluded as non-commercial, when known. */
  excluded: number | null;
  reason?: string;
  source: string;
}

export const loadCommercialClientCount = async (): Promise<CommercialClientCount> => {
  if (!isPanelDbConfigured()) {
    return { count: null, excluded: null, reason: "panel database not configured", source: COMMERCIAL_CLIENT_SOURCE };
  }
  try {
    const rows = await panelQuery<{ clients: string; total: string }>(
      `SELECT COUNT(*) FILTER (WHERE ${COMMERCIAL_CLIENT_PREDICATE})::int AS clients,
              COUNT(*) FILTER (WHERE COALESCE(is_active, TRUE) = TRUE)::int AS total
         FROM tenants`,
    );
    const r = rows[0];
    if (!r) return { count: null, excluded: null, reason: "client query returned no result", source: COMMERCIAL_CLIENT_SOURCE };
    const clients = Number(r.clients);
    const total = Number(r.total);
    if (!Number.isFinite(clients)) {
      return { count: null, excluded: null, reason: "client count was not numeric", source: COMMERCIAL_CLIENT_SOURCE };
    }
    return {
      count: clients,
      excluded: Number.isFinite(total) ? total - clients : null,
      source: COMMERCIAL_CLIENT_SOURCE,
    };
  } catch {
    return { count: null, excluded: null, reason: "client query failed", source: COMMERCIAL_CLIENT_SOURCE };
  }
};



export type ClientListItem = {
  id: string;
  name: string;
  domain: string | null;
  tenantType: string;
  status: string;
  createdAt: string | null;
  serviceCount: number;
  primaryEmail: string | null;
};

export type ClientDetail = {
  id: string;
  name: string;
  companyName: string | null;
  status: string;
  tenantType: string;
  createdAt: string | null;
  domains: ReadonlyArray<{ id: string; domain: string; status: string; autorenew: boolean }>;
  subscriptions: ReadonlyArray<{
    id: string;
    status: string;
    pricingModel: string | null;
    originalRate: number | null;
    renewalRate: number | null;
    createdAt: string | null;
  }>;
  invoices: ReadonlyArray<{ id: string; status: string; total: number; createdAt: string | null }>;
  mailboxes: ReadonlyArray<{ id: string; address: string; status: string; hasPassword: boolean }>;
  websites: ReadonlyArray<{ id: string; domain: string | null; status: string }>;
};

export type ClientsQuery = {
  q?: string;
  status?: string;
  limit?: number;
  /** Restrict to the commercial-client population — the exact predicate the
   *  Overview card counts with. Applied in SQL, not by post-filtering the
   *  returned rows: filtering afterwards on tenantType alone reproduced the
   *  original defect from the other side (the page showed 26 rows under a
   *  banner that said 10, because the row filter dropped the is_active half of
   *  the predicate). One predicate, one place. */
  commercialOnly?: boolean;
};

export const loadAllClients = async (
  arg?: number | ClientsQuery,
): Promise<ClientListItem[]> => {
  if (!isPanelDbConfigured()) return [];

  const query: ClientsQuery =
    typeof arg === "number" ? { limit: arg } : (arg || {});
  const limit = query.limit ?? 100;
  const q = (query.q || "").trim();
  const status = (query.status || "").trim();

  // Build dynamic WHERE clause defensively — only include the filters that are
  // set, and parameterize every value to keep this injection-safe.
  const where: string[] = query.commercialOnly
    ? [COMMERCIAL_CLIENT_PREDICATE.replace(/tenant_type/g, "t.tenant_type").replace(/is_active/g, "t.is_active")]
    : ["COALESCE(t.is_active, TRUE) = TRUE OR t.status IS NOT NULL"];
  const params: Array<string | number | boolean | null | Date> = [];

  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    const i = params.length;
    where.push(
      `(LOWER(COALESCE(t.name, '')) LIKE $${i} OR
        LOWER(COALESCE(t.company_name, '')) LIKE $${i} OR
        LOWER(COALESCE(t.slug, '')) LIKE $${i} OR
        LOWER(COALESCE(t.domain, '')) LIKE $${i} OR
        LOWER(COALESCE(t.billing_email, '')) LIKE $${i})`,
    );
  }

  if (status) {
    params.push(status);
    where.push(`COALESCE(t.status, 'active') = $${params.length}`);
  }

  params.push(limit);

  const rows = await panelQuery<{
    id: string;
    name: string;
    domain: string | null;
    tenanttype: string | null;
    status: string | null;
    createdat: string | null;
    servicecount: string;
    primaryemail: string | null;
  }>(
    `SELECT t.id,
            COALESCE(t.name, t.company_name, t.slug, t.id) AS name,
            COALESCE(
              t.domain,
              (SELECT d.domain FROM domains d WHERE d."tenantId" = t.id ORDER BY d."createdAt" ASC LIMIT 1)
            ) AS domain,
            COALESCE(t.tenant_type, 'CLIENT') AS tenanttype,
            COALESCE(t.status, CASE WHEN t.is_active THEN 'active' ELSE 'paused' END, 'active') AS status,
            t.createdat::text AS createdat,
            (SELECT COUNT(*) FROM subscriptions s WHERE s.tenantid = t.id AND s.status IN ('active','trialing'))::int::text AS servicecount,
            t.billing_email AS primaryemail
       FROM tenants t
      WHERE ${where.join(" AND ")}
      ORDER BY t.createdat DESC NULLS LAST
      LIMIT $${params.length}`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    domain: r.domain,
    tenantType: r.tenanttype || "CLIENT",
    status: r.status || "active",
    createdAt: r.createdat,
    serviceCount: Number(r.servicecount) || 0,
    primaryEmail: r.primaryemail,
  }));
};

export const loadDistinctClientStatuses = async (): Promise<string[]> => {
  if (!isPanelDbConfigured()) return [];
  const rows = await panelQuery<{ status: string | null }>(
    `SELECT DISTINCT COALESCE(status, 'active') AS status
       FROM tenants
      WHERE status IS NOT NULL OR is_active IS NOT NULL
      ORDER BY status ASC`,
  );
  const seen = new Set<string>();
  for (const r of rows) if (r.status) seen.add(r.status);
  ["active", "suspended", "paused", "churned"].forEach((s) => seen.add(s));
  return Array.from(seen).sort();
};

export const loadClientDetail = async (id: string): Promise<ClientDetail | null> => {
  if (!isPanelDbConfigured()) return null;
  const baseRows = await panelQuery<{
    id: string;
    name: string;
    companyname: string | null;
    status: string;
    tenanttype: string;
    createdat: string | null;
  }>(
    `SELECT id,
            COALESCE(name, company_name, slug, id) AS name,
            company_name AS companyname,
            COALESCE(status, 'active') AS status,
            COALESCE(tenant_type, 'CLIENT') AS tenanttype,
            createdat::text AS createdat
       FROM tenants
      WHERE id = $1`,
    [id],
  );
  if (baseRows.length === 0) return null;
  const base = baseRows[0]!;

  const [domains, subs, invoices, mailboxes, websites] = await Promise.all([
    panelQuery<{ id: string; domain: string; status: string; autorenew: boolean | null }>(
      `SELECT id, domain, status, COALESCE(autorenew, FALSE) AS autorenew
         FROM domains WHERE "tenantId" = $1 ORDER BY "createdAt" DESC`,
      [id],
    ),
    panelQuery<{
      id: string;
      status: string;
      pricingmodel: string | null;
      originalrate: string | null;
      renewalrate: string | null;
      createdat: string | null;
    }>(
      `SELECT id, status, pricing_model AS pricingmodel,
              original_rate::text AS originalrate,
              renewal_rate::text AS renewalrate,
              createdat::text AS createdat
         FROM subscriptions WHERE tenantid = $1 ORDER BY createdat DESC`,
      [id],
    ),
    panelQuery<{ id: string; status: string; total: string; createdat: string | null }>(
      `SELECT id, status, total::text AS total, createdat::text AS createdat
         FROM invoices WHERE tenantid = $1 ORDER BY createdat DESC LIMIT 20`,
      [id],
    ),
    panelQuery<{ id: string; address: string; status: string; haspassword: boolean }>(
      `SELECT id, address, COALESCE(status, 'active') AS status,
              CASE WHEN passwordhash IS NOT NULL AND LENGTH(TRIM(passwordhash)) > 0 THEN TRUE ELSE FALSE END AS haspassword
         FROM mailboxes WHERE tenantid = $1`,
      [id],
    ),
    panelQuery<{ id: string; domain: string | null; status: string }>(
      `SELECT id, "primaryDomain" AS domain, COALESCE(status, 'unknown') AS status
         FROM websites WHERE "tenantId" = $1 LIMIT 50`,
    [id]),
  ]);

  return {
    id: base.id,
    name: base.name,
    companyName: base.companyname,
    status: base.status,
    tenantType: base.tenanttype,
    createdAt: base.createdat,
    domains: domains.map((domain) => ({
      id: domain.id,
      domain: domain.domain,
      status: domain.status,
      autorenew: !!domain.autorenew,
    })),
    subscriptions: subs.map((s) => ({
      id: s.id,
      status: s.status,
      pricingModel: s.pricingmodel,
      originalRate: s.originalrate == null ? null : Number(s.originalrate),
      renewalRate: s.renewalrate == null ? null : Number(s.renewalrate),
      createdAt: s.createdat,
    })),
    invoices: invoices.map((i) => ({
      id: i.id,
      status: i.status,
      total: Number(i.total) || 0,
      createdAt: i.createdat,
    })),
    mailboxes: mailboxes.map((mailbox) => ({
      id: mailbox.id,
      address: mailbox.address,
      status: mailbox.status,
      hasPassword: mailbox.haspassword,
    })),
    websites,
  };
};
