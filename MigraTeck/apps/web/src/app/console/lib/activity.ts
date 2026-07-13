import { panelQuery, isPanelDbConfigured } from "./db";
import type { ActivityEvent } from "../components/ActivityFeed";

const KIND_MAP: Record<string, ActivityEvent["kind"]> = {
  hosting: "hosting",
  hosting_account_created: "hosting",
  domain: "dns",
  dns: "dns",
  billing: "billing",
  invoice: "billing",
  payment: "billing",
  marketing: "marketing",
  campaign: "marketing",
  voice: "voice",
  voicemail: "voice",
  email: "email",
  mailbox: "email",
  intake: "intake",
  form: "intake",
  security: "security",
  login: "security",
  auth: "security",
};

const KIND_HREF: Record<ActivityEvent["kind"], string> = {
  hosting: "/console/hosting",
  billing: "/console/billing",
  marketing: "/console/marketing",
  voice: "/console/voice",
  email: "/console/email",
  intake: "/console/intake",
  security: "/console/security",
  dns: "/console/domains",
};

const mapKind = (action: string | null): ActivityEvent["kind"] => {
  if (!action) return "hosting";
  const lower = action.toLowerCase();
  for (const key of Object.keys(KIND_MAP)) {
    if (lower.includes(key)) return KIND_MAP[key]!;
  }
  return "hosting";
};

const relativeTime = (iso: string): string => {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, Math.floor((now - then) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

export const loadRecentActivity = async (limit = 8): Promise<ReadonlyArray<ActivityEvent>> => {
  if (!isPanelDbConfigured()) return [];
  const rows = await panelQuery<{
    id: string;
    action: string | null;
    description: string | null;
    actor: string | null;
    tenantname: string | null;
    createdat: string;
  }>(
    `SELECT a.id,
            a.actionkey AS action,
            CONCAT(
              INITCAP(REPLACE(a.actionkey, '.', ' ')),
              ' (', a.resourcetype, ')'
            ) AS description,
            COALESCE(u.display_name,
                     NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''),
                     u.email,
                     a.actortype) AS actor,
            t.name AS tenantname,
            a.createdat::text AS createdat
       FROM audit_events a
       LEFT JOIN users u ON u.id = a.actoruserid
       LEFT JOIN tenants t ON t.id = a.tenantid
      ORDER BY a.createdat DESC
      LIMIT $1`,
    [limit],
  );
  if (rows.length === 0) {
    const fallbackRows = await panelQuery<{
      id: string;
      kind: ActivityEvent["kind"];
      title: string;
      context: string | null;
      actor: string | null;
      createdat: string;
    }>(
      `SELECT *
         FROM (
           SELECT m.id,
                  'email'::text AS kind,
                  CONCAT('Mailbox provisioned: ', m.address) AS title,
                  t.name AS context,
                  NULL::text AS actor,
                  m.createdat::text AS createdat
             FROM mailboxes m
             LEFT JOIN tenants t ON t.id = m.tenantid
            UNION ALL
           SELECT d.id,
                  'dns'::text AS kind,
                  CONCAT('Domain onboarded: ', d.domain) AS title,
                  t.name AS context,
                  NULL::text AS actor,
                  d."createdAt"::text AS createdat
             FROM domains d
             LEFT JOIN tenants t ON t.id = d."tenantId"
            UNION ALL
           SELECT i.id,
                  'billing'::text AS kind,
                  CONCAT('Invoice ', UPPER(COALESCE(i.status, 'created')), ' · $', ROUND(COALESCE(i.total, 0)::numeric, 2)) AS title,
                  t.name AS context,
                  NULL::text AS actor,
                  i.createdat::text AS createdat
             FROM invoices i
             LEFT JOIN tenants t ON t.id = i.tenantid
            UNION ALL
           SELECT w.id,
                  'hosting'::text AS kind,
                  CONCAT('Website provisioned: ', COALESCE(w.name, w."primaryDomain")) AS title,
                  t.name AS context,
                  NULL::text AS actor,
                  w."createdAt"::text AS createdat
             FROM websites w
             LEFT JOIN tenants t ON t.id = w."tenantId"
         ) recent
        ORDER BY createdat DESC
        LIMIT $1`,
      [limit],
    );

    return fallbackRows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      ...(r.context ? { context: `for ${r.context}` } : {}),
      ...(r.actor ? { actor: r.actor } : {}),
      href: KIND_HREF[r.kind],
      isoTime: r.createdat,
      relativeTime: relativeTime(r.createdat),
    }));
  }

  return rows.map((r) => {
    const evt: ActivityEvent = {
      id: r.id,
      kind: mapKind(r.action),
      title: r.description || "Activity",
      isoTime: r.createdat,
      relativeTime: relativeTime(r.createdat),
    };
    if (r.tenantname) evt.context = `for ${r.tenantname}`;
    if (r.actor) evt.actor = r.actor;
    evt.href = KIND_HREF[evt.kind];
    return evt;
  });
};
