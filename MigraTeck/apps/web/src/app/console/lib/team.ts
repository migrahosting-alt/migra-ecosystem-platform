import { panelQuery, isPanelDbConfigured } from "./db";
import type { TeamMember } from "../components/TeamPerformance";

export const loadTeamMembers = async (): Promise<ReadonlyArray<TeamMember>> => {
  if (!isPanelDbConfigured()) return [];

  const rows = await panelQuery<{
    id: string;
    name: string;
    role: string;
    activetasks: string;
    workload: string;
    status: string;
  }>(
    `WITH task_counts AS (
       SELECT assigned_to, COUNT(*)::int AS cnt
         FROM chat_tickets
        WHERE status NOT IN ('closed','resolved')
          AND assigned_to IS NOT NULL
        GROUP BY assigned_to
     ),
     max_tasks AS (
       SELECT GREATEST(MAX(cnt), 1)::numeric AS max_cnt FROM task_counts
     )
     SELECT u.id,
            COALESCE(u.display_name,
                     NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''),
                     u.email,
                     u.id) AS name,
            COALESCE(u.role, 'staff') AS role,
            COALESCE(tc.cnt, 0)::text AS activetasks,
            ROUND((COALESCE(tc.cnt, 0)::numeric / mt.max_cnt) * 100)::text AS workload,
            CASE
              WHEN u.last_login_at >= NOW() - INTERVAL '5 minutes' THEN 'available'
              WHEN u.last_login_at >= NOW() - INTERVAL '1 hour' THEN 'busy'
              WHEN u.last_login_at >= NOW() - INTERVAL '1 day' THEN 'away'
              ELSE 'offline'
            END AS status
       FROM users u
       LEFT JOIN task_counts tc ON tc.assigned_to = u.id
       CROSS JOIN max_tasks mt
      WHERE COALESCE(u.is_active, TRUE) = TRUE
        AND u.role IN ('admin','support','agent','sales','engineer','manager','staff','operations','customer')
      ORDER BY u.last_login_at DESC NULLS LAST, u.createdat DESC
      LIMIT 10`,
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    activeTasks: Number(r.activetasks) || 0,
    workloadPct: Math.min(100, Math.max(0, Number(r.workload) || 0)),
    status: (["available", "busy", "away", "offline"].includes(r.status)
      ? r.status
      : "offline") as TeamMember["status"],
  }));
};
