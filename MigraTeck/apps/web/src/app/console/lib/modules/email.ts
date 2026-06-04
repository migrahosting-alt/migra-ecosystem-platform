import { panelQuery, isPanelDbConfigured } from "../db";

export type MailDomain = { id: string; domain: string; status: string; tenantName: string | null };
export type Mailbox = { id: string; address: string; status: string; tenantName: string | null; createdAt: string | null };
export type MailAlias = { id: string; sourceLocal: string; destination: string; isActive: boolean };

export const loadEmailData = async () => {
  if (!isPanelDbConfigured()) return { domains: [], mailboxes: [], aliases: [] };
  const [domains, mailboxes, aliases] = await Promise.all([
    panelQuery<{ id: string; domain: string; status: string; tenantname: string | null }>(
      `SELECT md.id, md.domain, COALESCE(md.status, 'active') AS status, t.name AS tenantname
         FROM mail_domains md
         LEFT JOIN tenants t ON t.id = md.tenantid
        ORDER BY md.createdat DESC NULLS LAST
        LIMIT 50`,
    ),
    panelQuery<{ id: string; address: string; status: string; tenantname: string | null; createdat: string | null }>(
      `SELECT m.id, m.address, COALESCE(m.status, 'active') AS status,
              t.name AS tenantname, m.createdat::text AS createdat
         FROM mailboxes m
         LEFT JOIN tenants t ON t.id = m.tenantid
        ORDER BY m.createdat DESC NULLS LAST
        LIMIT 100`,
    ),
    panelQuery<{ id: string; sourcelocal: string; destination: string; isactive: boolean }>(
      `SELECT id, source AS sourcelocal, destination, TRUE AS isactive
         FROM mail_aliases
        ORDER BY createdat DESC NULLS LAST
        LIMIT 50`,
    ),
  ]);
  return {
    domains: domains.map((d) => ({ id: d.id, domain: d.domain, status: d.status, tenantName: d.tenantname })),
    mailboxes: mailboxes.map((m) => ({ id: m.id, address: m.address, status: m.status, tenantName: m.tenantname, createdAt: m.createdat })),
    aliases: aliases.map((a) => ({ id: a.id, sourceLocal: a.sourcelocal, destination: a.destination, isActive: a.isactive })),
  };
};
