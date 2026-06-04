import { panelQuery, isPanelDbConfigured } from "./db";
import type { SupportSlaData } from "../components/SupportSlaPanel";

const empty = (): SupportSlaData => ({
  totals: { totalTickets: 0, openTickets: 0, avgResponseMinutes: null, slaCompliancePct: null },
  delta: { totalPct: 0, openPct: 0, responsePct: 0, compliancePct: 0 },
  byPriority: { critical: 0, high: 0, medium: 0, low: 0 },
  agents: [],
});

export const loadSupportSla = async (): Promise<SupportSlaData> => {
  if (!isPanelDbConfigured()) return empty();

  const [
    totals,
    byPri,
    agents,
  ] = await Promise.all([
    panelQuery<{
      total: string;
      open: string;
      avgresponse: string | null;
      compliance: string | null;
    }>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status NOT IN ('closed','resolved'))::int AS open,
              ROUND(AVG(EXTRACT(EPOCH FROM (first_response_at - created_at)) / 60))::int AS avgresponse,
              ROUND((COUNT(*) FILTER (WHERE sla_breached = FALSE)::numeric / NULLIF(COUNT(*), 0)) * 100, 1) AS compliance
         FROM chat_tickets
        WHERE created_at >= NOW() - INTERVAL '7 days'`,
    ),
    panelQuery<{ priority: string; count: string }>(
      `SELECT LOWER(priority) AS priority, COUNT(*)::int AS count
         FROM chat_tickets
        WHERE status NOT IN ('closed','resolved')
        GROUP BY LOWER(priority)`,
    ),
    panelQuery<{ id: string; name: string; workload: string }>(
      `SELECT u.id, COALESCE(u.display_name, u.email) AS name,
              ROUND((COUNT(t.id)::numeric / NULLIF((SELECT MAX(workload) FROM (
                SELECT assigned_to, COUNT(*)::numeric AS workload FROM chat_tickets WHERE status NOT IN ('closed','resolved') GROUP BY assigned_to
              ) x), 0)) * 100)::int AS workload
         FROM users u
         LEFT JOIN chat_tickets t ON t.assigned_to = u.id AND t.status NOT IN ('closed','resolved')
        WHERE u.role IN ('support','admin','agent')
        GROUP BY u.id, u.display_name, u.email
        ORDER BY workload DESC NULLS LAST
        LIMIT 5`,
    ),
  ]);

  const t = totals[0];
  const priMap: Record<string, number> = {};
  for (const r of byPri) priMap[r.priority] = Number(r.count);

  return {
    totals: {
      totalTickets: t ? Number(t.total) : 0,
      openTickets: t ? Number(t.open) : 0,
      avgResponseMinutes: t && t.avgresponse != null ? Number(t.avgresponse) : null,
      slaCompliancePct: t && t.compliance != null ? Number(t.compliance) : null,
    },
    delta: { totalPct: 0, openPct: 0, responsePct: 0, compliancePct: 0 },
    byPriority: {
      critical: priMap.critical || 0,
      high: priMap.high || 0,
      medium: priMap.medium || 0,
      low: priMap.low || 0,
    },
    agents: agents.map((a) => ({
      id: a.id,
      name: a.name,
      workloadPct: Math.min(100, Math.max(0, Number(a.workload) || 0)),
    })),
  };
};
