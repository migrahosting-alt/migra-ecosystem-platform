import { panelQuery, isPanelDbConfigured } from "../db";

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
  domains: ReadonlyArray<{ id: string; domain: string; status: string }>;
  subscriptions: ReadonlyArray<{
    id: string;
    status: string;
    pricingModel: string | null;
    originalRate: number | null;
    renewalRate: number | null;
    createdAt: string | null;
  }>;
  invoices: ReadonlyArray<{ id: string; status: string; total: number; createdAt: string | null }>;
  mailboxes: ReadonlyArray<{ id: string; address: string; status: string }>;
  websites: ReadonlyArray<{ id: string; domain: string | null; status: string }>;
};

export type ClientsQuery = {
  q?: string;
  status?: string;
  limit?: number;
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
  const where: string[] = ["COALESCE(t.is_active, TRUE) = TRUE OR t.status IS NOT NULL"];
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
    panelQuery<{ id: string; domain: string; status: string }>(
      `SELECT id, domain, status FROM domains WHERE "tenantId" = $1 ORDER BY "createdAt" DESC`,
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
    panelQuery<{ id: string; address: string; status: string }>(
      `SELECT id, address, COALESCE(status, 'active') AS status
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
    domains,
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
    mailboxes,
    websites,
  };
};
