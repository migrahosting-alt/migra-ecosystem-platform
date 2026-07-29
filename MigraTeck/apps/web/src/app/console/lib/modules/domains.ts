import { panelQuery, isPanelDbConfigured } from "../db";

export type DomainRow = { id: string; domain: string; status: string; role: string; tenantName: string | null; createdAt: string | null; expiresAt: string | null };
export type DnsZone = { id: string; zone: string; status: string };
export type DomainTransfer = { id: string; domain: string | null; status: string; createdAt: string | null };

/**
 * Domains expiring within the next 30 days. Pure given `nowMs`, so it is testable and the
 * whole list is measured against ONE instant rather than a clock that ticks mid-filter.
 */
const DAY_MS = 86_400_000;
export const countExpiringSoon = (
  domains: ReadonlyArray<{ expiresat?: string | null }>,
  nowMs: number,
): number =>
  domains.filter((d) => {
    if (!d.expiresat) return false;
    const days = (new Date(d.expiresat).getTime() - nowMs) / DAY_MS;
    return days >= 0 && days <= 30;
  }).length;

export const loadDomainsData = async () => {
  if (!isPanelDbConfigured()) return { domains: [], zones: [], transfers: [], expiringSoon: 0 };
  const [domains, zones, transfers] = await Promise.all([
    panelQuery<{ id: string; domain: string; status: string; role: string; tenantname: string | null; createdat: string | null; expiresat: string | null }>(
      `SELECT d.id, d.domain, d.status, d.role, t.name AS tenantname,
              d."createdAt"::text AS createdat, d.expiresat::text AS expiresat
         FROM domains d
         LEFT JOIN tenants t ON t.id = d."tenantId"
        ORDER BY d."createdAt" DESC NULLS LAST
        LIMIT 100`,
    ),
    panelQuery<{ id: string; zone: string; status: string }>(
      `SELECT id, name AS zone, COALESCE(status, 'active') AS status FROM dns_zones ORDER BY name ASC LIMIT 100`,
    ),
    panelQuery<{ id: string; domain: string | null; status: string; createdat: string | null }>(
      `SELECT dtr.id,
              dtr.domainname AS domain,
              COALESCE(dtr.status, 'pending') AS status,
              dtr.createdat::text AS createdat
         FROM domain_transfer_requests dtr
        ORDER BY dtr.createdat DESC NULLS LAST
        LIMIT 30`,
    ),
  ]);
  return {
    // Computed HERE, not in the page: reading the clock is expected in a data loader,
    // and is exactly the impure call the render-purity rule rightly rejects inside a
    // component.
    expiringSoon: countExpiringSoon(domains, Date.now()),
    domains: domains.map((d) => ({ id: d.id, domain: d.domain, status: d.status, role: d.role, tenantName: d.tenantname, createdAt: d.createdat, expiresAt: d.expiresat })),
    zones: zones.map((z) => ({ id: z.id, zone: z.zone, status: z.status })),
    transfers: transfers.map((t) => ({ id: t.id, domain: t.domain, status: t.status, createdAt: t.createdat })),
  };
};
