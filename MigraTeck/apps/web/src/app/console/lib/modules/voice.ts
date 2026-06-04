import { panelQuery, isPanelDbConfigured } from "../db";

export type PhoneNumber = { id: string; number: string; status: string; tenantName: string | null };
export type Extension = { id: string; extension: string; displayName: string | null; enabled: boolean };
export type Ivr = { id: string; name: string; status: string };

export const loadVoiceData = async () => {
  if (!isPanelDbConfigured()) return { numbers: [], extensions: [], ivrs: [] };
  const [numbers, extensions, ivrs] = await Promise.all([
    panelQuery<{ id: string; number: string; status: string; tenantname: string | null }>(
      `SELECT n.id, n.displaynumber AS number, COALESCE(n.status, 'active') AS status, t.name AS tenantname
         FROM business_phone_numbers n
         LEFT JOIN tenants t ON t.id = n.tenantid
        ORDER BY n.createdat DESC NULLS LAST
        LIMIT 100`,
    ),
    panelQuery<{ id: string; extension: string; displayname: string | null; enabled: boolean }>(
      `SELECT id, extension, display_name AS displayname, COALESCE(enabled, TRUE) AS enabled
         FROM business_phone_extensions
        ORDER BY extension ASC
        LIMIT 100`,
    ),
    panelQuery<{ id: string; name: string; status: string }>(
      `SELECT id, name, CASE WHEN enabled THEN 'active' ELSE 'inactive' END AS status
         FROM business_phone_ivrs
        ORDER BY name ASC
        LIMIT 50`,
    ),
  ]);
  return {
    numbers: numbers.map((n) => ({ id: n.id, number: n.number, status: n.status, tenantName: n.tenantname })),
    extensions: extensions.map((e) => ({ id: e.id, extension: e.extension, displayName: e.displayname, enabled: e.enabled })),
    ivrs: ivrs.map((i) => ({ id: i.id, name: i.name, status: i.status })),
  };
};
