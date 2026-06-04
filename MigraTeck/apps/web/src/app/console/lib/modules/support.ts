import { panelQuery, isPanelDbConfigured } from "../db";

export type SupportTicket = {
  id: string;
  subject: string | null;
  status: string;
  priority: string | null;
  tenantName: string | null;
  assigneeName: string | null;
  createdAt: string | null;
};
export type SupportAgent = { id: string; name: string; status: string; openTickets: number };

export const loadSupportData = async () => {
  if (!isPanelDbConfigured()) return { tickets: [], agents: [] };
  const [tickets, agents] = await Promise.all([
    panelQuery<{
      id: string; subject: string | null; status: string; priority: string | null;
      tenantname: string | null; assigneename: string | null; createdat: string | null;
    }>(
      `SELECT ct.id, ct.subject,
              COALESCE(ct.status, 'open') AS status,
              ct.priority,
              t.name AS tenantname,
              COALESCE(u.display_name, u.email) AS assigneename,
              ct.created_at::text AS createdat
         FROM chat_tickets ct
         LEFT JOIN tenants t ON t.id = ct.tenant_id
         LEFT JOIN users u ON u.id = ct.assigned_to
        ORDER BY ct.created_at DESC NULLS LAST
        LIMIT 100`,
    ),
    panelQuery<{ id: string; name: string; status: string; opentickets: string }>(
      `SELECT u.id,
              COALESCE(u.display_name, u.email) AS name,
              CASE
                WHEN u.last_login_at >= NOW() - INTERVAL '5 minutes' THEN 'available'
                WHEN u.last_login_at >= NOW() - INTERVAL '1 hour' THEN 'busy'
                ELSE 'offline'
              END AS status,
              (SELECT COUNT(*) FROM chat_tickets ct WHERE ct.assigned_to = u.id AND ct.status NOT IN ('closed','resolved'))::text AS opentickets
         FROM users u
        WHERE u.role IN ('admin','support','agent')
        ORDER BY name ASC
        LIMIT 30`,
    ),
  ]);
  return {
    tickets: tickets.map((t) => ({
      id: t.id,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      tenantName: t.tenantname,
      assigneeName: t.assigneename,
      createdAt: t.createdat,
    })),
    agents: agents.map((a) => ({ id: a.id, name: a.name, status: a.status, openTickets: Number(a.opentickets) || 0 })),
  };
};
