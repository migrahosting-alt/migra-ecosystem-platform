import { panelQuery, isPanelDbConfigured } from "../db";

export type GrowthLead = { id: string; name: string | null; email: string | null; status: string; createdAt: string | null; source: string | null };
export type FormBinding = { id: string; formname: string | null; status: string; submissions: number; provider: string | null };

export const loadIntakeData = async () => {
  if (!isPanelDbConfigured()) return { leads: [], forms: [] };
  const [leads, forms] = await Promise.all([
    panelQuery<{ id: string; name: string | null; email: string | null; status: string; createdat: string | null; source: string | null }>(
      `SELECT id,
              COALESCE(contactname, businessname) AS name,
              email,
              COALESCE(status, 'new') AS status,
              createdat::text AS createdat,
              source
         FROM growth_leads
        ORDER BY createdat DESC NULLS LAST
        LIMIT 100`,
    ),
    panelQuery<{ id: string; formname: string | null; status: string; submissions: string; provider: string | null }>(
      `SELECT bfb.id,
              COALESCE(w."primaryDomain", w."customDomain", bfb."siteId") AS formname,
              'active'::text AS status,
              COALESCE(
                (SELECT COUNT(*)::text FROM growth_leads gl WHERE gl.siteid = bfb."siteId"),
                '0'
              ) AS submissions,
              bfb.provider::text AS provider
         FROM builder_form_bindings bfb
         LEFT JOIN websites w ON w.id = bfb."siteId"
        ORDER BY bfb."createdAt" DESC NULLS LAST
        LIMIT 50`,
    ),
  ]);
  return {
    leads: leads.map((l) => ({ id: l.id, name: l.name, email: l.email, status: l.status, createdAt: l.createdat, source: l.source })),
    forms: forms.map((f) => ({ id: f.id, formname: f.formname, status: f.status, submissions: Number(f.submissions) || 0, provider: f.provider })),
  };
};
