import { panelQuery, isPanelDbConfigured } from "./db";

export type ClientAccount = {
  id: string;
  name: string;
  domain: string | null;
  services: ReadonlyArray<{ id: string; shortCode: string; accent: string }>;
  planTier: string;
  accountManager: string;
  lastActivity: { iso: string; relative: string } | null;
  status: "active" | "paused" | "trial" | "churned";
};

const SERVICE_ACCENTS: Record<string, string> = {
  hosting: "from-sky-500 to-cyan-500",
  panel: "from-violet-500 to-purple-500",
  voice: "from-rose-500 to-orange-500",
  email: "from-emerald-500 to-teal-500",
  intake: "from-amber-500 to-yellow-500",
  marketing: "from-pink-500 to-rose-500",
  automation: "from-blue-500 to-indigo-500",
  drive: "from-fuchsia-500 to-pink-500",
};

const SHORT_CODES: Record<string, string> = {
  hosting: "MH",
  panel: "MP",
  voice: "MV",
  email: "MM",
  intake: "MI",
  marketing: "MK",
  automation: "AU",
  drive: "MD",
};

const relativeTime = (iso: string | null): { iso: string; relative: string } | null => {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, Math.floor((now - then) / 1000));
  let relative: string;
  if (diff < 60) relative = `${diff}s ago`;
  else if (diff < 3600) relative = `${Math.floor(diff / 60)}m ago`;
  else if (diff < 86400) relative = `${Math.floor(diff / 3600)}h ago`;
  else relative = `${Math.floor(diff / 86400)}d ago`;
  return { iso, relative };
};

export const loadRecentClients = async (limit = 20): Promise<ClientAccount[]> => {
  if (!isPanelDbConfigured()) return [];
  const rows = await panelQuery<{
    id: string;
    name: string;
    domain: string | null;
    plantier: string;
    accountmanager: string;
    lastactivity: string | null;
    status: string | null;
    services: string | null;
  }>(
    `SELECT t.id,
            COALESCE(t.name, t.company_name, t.slug, t.id) AS name,
            COALESCE(
              t.domain,
              (SELECT d.domain FROM domains d WHERE d."tenantId" = t.id ORDER BY d."createdAt" ASC LIMIT 1)
            ) AS domain,
            COALESCE(
              (SELECT pricing_model FROM subscriptions s WHERE s.tenantid = t.id AND s.status IN ('active','trialing') ORDER BY s.createdat DESC LIMIT 1),
              'Free'
            ) AS plantier,
            '—' AS accountmanager,
            t.createdat::text AS lastactivity,
            COALESCE(t.status, CASE WHEN t.is_active THEN 'active' ELSE 'paused' END, 'active') AS status,
            (
              SELECT string_agg(DISTINCT s.pricing_model, ',')
                FROM subscriptions s
               WHERE s.tenantid = t.id
                 AND s.status IN ('active','trialing')
            ) AS services
       FROM tenants t
      WHERE COALESCE(t.is_active, TRUE) = TRUE
      ORDER BY t.createdat DESC NULLS LAST
      LIMIT $1`,
    [limit],
  );

  return rows.map((r) => {
    const productIds = (r.services || "")
      .split(",")
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);
    return {
      id: r.id,
      name: r.name,
      domain: r.domain,
      services: productIds.map((id) => ({
        id,
        shortCode: SHORT_CODES[id] || id.slice(0, 2).toUpperCase(),
        accent: SERVICE_ACCENTS[id] || "from-slate-500 to-slate-700",
      })),
      planTier: r.plantier || "Free",
      accountManager: r.accountmanager || "—",
      lastActivity: relativeTime(r.lastactivity),
      status: (["active", "paused", "trial", "churned"].includes(r.status || "")
        ? r.status
        : "active") as ClientAccount["status"],
    };
  });
};
