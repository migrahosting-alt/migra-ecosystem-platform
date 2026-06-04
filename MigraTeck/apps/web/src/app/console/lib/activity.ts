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
  intake: "intake",
  form: "intake",
  security: "security",
  login: "security",
  auth: "security",
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
    return evt;
  });
};
