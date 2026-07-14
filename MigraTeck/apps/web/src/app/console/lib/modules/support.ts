import { panelQuery, isPanelDbConfigured } from "../db";

export type SupportTicket = {
  id: string;
  ticketNumber: string | null;
  subject: string | null;
  department: string | null;
  status: string;
  priority: string | null;
  tenantId: string | null;
  tenantName: string | null;
  customerName: string | null;
  customerEmail: string | null;
  createdBy: string | null;
  tags: string[];
  assigneeName: string | null;
  assigneeId: string | null;
  messageCount: number;
  lastMessageAt: string | null;
  firstResponseAt: string | null;
  slaDeadline: string | null;
  slaBreached: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};
export type SupportAgent = { id: string; name: string; status: string; openTickets: number };
export type SupportMessage = {
  id: string;
  sender: string;
  senderName: string | null;
  body: string;
  isInternal: boolean;
  aiGenerated: boolean;
  createdAt: string | null;
};
export type SupportTicketDetail = {
  ticket: SupportTicket;
  messages: SupportMessage[];
  agents: SupportAgent[];
  audit: Array<{ id: string; eventType: string; actorLabel: string | null; fromState: string | null; toState: string | null; createdAt: string | null }>;
};

export type SupportReplyMacro = {
  id: string;
  body: string;
  usageCount: number;
  lastUsedAt: string | null;
};

export type SupportQuery = {
  tenantId?: string;
};

export const loadSupportData = async (query: SupportQuery = {}) => {
  if (!isPanelDbConfigured()) return { tickets: [], agents: [] };
  const params: string[] = [];
  const where: string[] = [];
  if (query.tenantId) {
    params.push(query.tenantId);
    where.push(`ct."tenantId" = $${params.length}`);
  }
  const [tickets, agents] = await Promise.all([
    panelQuery<{
      id: string;
      ticketnumber: string | null;
      subject: string | null;
      department: string | null;
      status: string;
      priority: string | null;
      tenantid: string | null;
      tenantname: string | null;
      customername: string | null;
      customeremail: string | null;
      createdby: string | null;
      tags: string | null;
      assigneename: string | null;
      assigneeid: string | null;
      messagecount: string;
      lastmessageat: string | null;
      firstresponseat: string | null;
      sladeadline: string | null;
      slabreached: boolean | null;
      createdat: string | null;
      updatedat: string | null;
    }>(
      `SELECT ct.id,
              ct.display_number AS ticketnumber,
              COALESCE(ct.subject, 'Abigail live support') AS subject,
              ct.department,
              COALESCE(ct.status, 'open') AS status,
              ct.priority,
              ct."tenantId" AS tenantid,
              COALESCE(t.name, t.company_name, t.slug, t.id) AS tenantname,
              ct."visitorName" AS customername,
              ct."visitorEmail" AS customeremail,
              ct."customerId" AS createdby,
              '[]'::text AS tags,
              COALESCE(u.display_name, u.email) AS assigneename,
              ct."assignedUserId" AS assigneeid,
              (SELECT COUNT(*)::int FROM chat_messages m WHERE m."conversationId" = ct.id)::text AS messagecount,
              ct."lastMessageAt"::text AS lastmessageat,
              ct.first_response_at::text AS firstresponseat,
              CASE WHEN cfg.enabled THEN (ct."createdAt" + make_interval(mins => cfg.first_response_mins))::text ELSE NULL END AS sladeadline,
              CASE WHEN cfg.enabled AND ct.first_response_at IS NULL THEN NOW() > ct."createdAt" + make_interval(mins => cfg.first_response_mins) ELSE FALSE END AS slabreached,
              ct."createdAt"::text AS createdat,
              ct."updatedAt"::text AS updatedat
         FROM chat_conversations ct
         LEFT JOIN tenants t ON t.id = ct."tenantId"
         LEFT JOIN users u ON u.id = ct."assignedUserId"
         LEFT JOIN LATERAL (
           SELECT first_response_mins, enabled FROM chat_sla_config
            WHERE LOWER(department) = LOWER(ct.department) OR LOWER(department) = 'default'
            ORDER BY CASE WHEN LOWER(department) = LOWER(ct.department) THEN 0 ELSE 1 END LIMIT 1
         ) cfg ON TRUE
        WHERE ct.mode = 'human'
          ${where.length ? `AND ${where.join(" AND ")}` : ""}
        ORDER BY ct."lastMessageAt" DESC NULLS LAST, ct."createdAt" DESC
        LIMIT 100`,
      params,
    ),
    panelQuery<{ id: string; name: string; status: string; opentickets: string }>(
      `SELECT u.id,
              COALESCE(u.display_name, u.email) AS name,
              COALESCE(p.status, CASE
                WHEN u.last_login_at >= NOW() - INTERVAL '5 minutes' THEN 'available'
                WHEN u.last_login_at >= NOW() - INTERVAL '1 hour' THEN 'busy'
                ELSE 'offline'
              END) AS status,
              (SELECT COUNT(*) FROM chat_conversations ct
                WHERE ct."assignedUserId" = u.id
                  AND ct.mode = 'human'
                  AND ct.status NOT IN ('closed','resolved'))::text AS opentickets
         FROM users u
         LEFT JOIN chat_agent_presence p ON p.admin_id = u.id AND p.last_seen >= NOW() - INTERVAL '2 minutes'
        WHERE u.role IN ('admin','support','agent','super_admin','ops')
        ORDER BY name ASC
        LIMIT 30`,
    ),
  ]);
  return {
    tickets: tickets.map((t) => ({
      id: t.id,
      ticketNumber: t.ticketnumber,
      subject: t.subject,
      department: t.department,
      status: t.status,
      priority: t.priority,
      tenantId: t.tenantid,
      tenantName: t.tenantname,
      customerName: t.customername,
      customerEmail: t.customeremail,
      createdBy: t.createdby,
      tags: (() => {
        try {
          const raw = JSON.parse(t.tags || "[]");
          return Array.isArray(raw) ? raw.map((entry) => String(entry)) : [];
        } catch {
          return (t.tags || "")
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean);
        }
      })(),
      assigneeName: t.assigneename,
      assigneeId: t.assigneeid,
      messageCount: Number(t.messagecount) || 0,
      lastMessageAt: t.lastmessageat,
      firstResponseAt: t.firstresponseat,
      slaDeadline: t.sladeadline,
      slaBreached: !!t.slabreached,
      createdAt: t.createdat,
      updatedAt: t.updatedat,
    })),
    agents: agents.map((a) => ({ id: a.id, name: a.name, status: a.status, openTickets: Number(a.opentickets) || 0 })),
  };
};

export const loadSupportTicketDetail = async (id: string): Promise<SupportTicketDetail | null> => {
  if (!isPanelDbConfigured() || !id) return null;
  const [data, messages, auditRows] = await Promise.all([
    loadSupportData(),
    panelQuery<{
      id: string;
      sender: string;
      sendername: string | null;
      body: string;
      isinternal: boolean | null;
      aigenerated: boolean | null;
      createdat: string | null;
    }>(
      `SELECT m.id,
              CASE
                WHEN m."authorType" = 'agent' THEN 'admin'
                WHEN m."authorType" = 'assistant' THEN 'ai'
                WHEN m."authorType" IN ('visitor', 'client') THEN 'customer'
                ELSE m."authorType"
              END AS sender,
              CASE
                WHEN m."authorType" = 'assistant' THEN 'Abigail'
                WHEN m."authorType" = 'agent' THEN COALESCE(u.display_name, u.email, 'Support')
                WHEN m."authorType" IN ('visitor', 'client') THEN COALESCE(c."visitorName", 'Customer')
                ELSE 'System'
              END AS sendername,
              m.content AS body,
              COALESCE(is_internal, FALSE) AS isinternal,
              (m."authorType" = 'assistant') AS aigenerated,
              m."createdAt"::text AS createdat
         FROM chat_messages m
         JOIN chat_conversations c ON c.id = m."conversationId"
         LEFT JOIN users u ON u.id = m."authorUserId"
        WHERE m."conversationId" = $1
        ORDER BY m."createdAt" ASC`,
      [id],
    ),
    panelQuery<{ id: string; eventtype: string; actorlabel: string | null; fromstate: string | null; tostate: string | null; createdat: string | null }>(
      `SELECT id, event_type AS eventtype, actor_label AS actorlabel, from_state AS fromstate, to_state AS tostate, created_at::text AS createdat
         FROM support_conversation_audit WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [id],
    ),
  ]);
  const ticket = data.tickets.find((entry) => entry.id === id) || null;
  if (!ticket) return null;
  return {
    ticket,
    agents: data.agents,
    audit: auditRows.map((row) => ({ id: row.id, eventType: row.eventtype, actorLabel: row.actorlabel, fromState: row.fromstate, toState: row.tostate, createdAt: row.createdat })),
    messages: messages.map((message) => ({
      id: message.id,
      sender: message.sender,
      senderName: message.sendername,
      body: message.body,
      isInternal: !!message.isinternal,
      aiGenerated: !!message.aigenerated,
      createdAt: message.createdat,
    })),
  };
};

/**
 * Resolve the signed-in employee to a real staff identity in `users`.
 *
 * FAIL CLOSED. This must only ever return the user whose email actually
 * matches the authenticated session.
 *
 * History: this function previously had NO email predicate in its WHERE clause.
 * It selected from all active staff and used ORDER BY to *prefer* the matching
 * email, falling back to `admin@migrahosting.com` and then to any admin. An
 * unknown or unmapped signed-in email therefore silently resolved to another
 * real person, and every claim/transfer/resolve/note was attributed to them.
 * That is an auditability defect, not a convenience: it fabricates an actor.
 *
 * Returning null means "identity not established" and every caller must deny
 * the action rather than substitute anyone.
 */
export const loadSupportActor = async (email: string): Promise<{ id: string; name: string } | null> => {
  if (!isPanelDbConfigured() || !email) return null;
  const rows = await panelQuery<{ id: string; name: string }>(
    `SELECT id,
            COALESCE(display_name, NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), ''), 'Support') AS name
       FROM users
      WHERE LOWER(email) = LOWER($1)
        AND role IN ('admin','support','agent','super_admin','ops')
        AND COALESCE(is_active, TRUE) = TRUE
      LIMIT 1`,
    [email],
  );
  return rows[0] || null;
};

/**
 * Why an actor could not be resolved. Lets the caller tell an unmapped-but-real
 * employee ("link your identity") apart from a genuine outsider ("denied").
 */
export type SupportActorDenial =
  | "no_session"
  | "not_staff"
  | "staff_not_linked" // exists in mail_staff_user (legacy console identity) but has no `users` row
  | "inactive";

export type SupportActorResult =
  | { ok: true; actor: { id: string; name: string } }
  | { ok: false; reason: SupportActorDenial };

/**
 * Compatibility resolver for the legacy `mail_staff_user` console identity.
 *
 * `mail_staff_user` is the console's own staff table (1 row in production);
 * panel-api's identity lives in `users` + `memberships`. Support actions write
 * `chat_*.authorUserId`, which references `users`, so a mail_staff_user record
 * alone CANNOT act — there is no user id to attribute the action to.
 *
 * This resolver exists to explain that state, NOT to invent an actor. If a
 * legacy staff record has no linked `users` row we return `staff_not_linked`
 * and the action is denied.
 */
export const resolveSupportActor = async (email: string | null | undefined): Promise<SupportActorResult> => {
  if (!email) return { ok: false, reason: "no_session" };

  const actor = await loadSupportActor(email);
  if (actor) return { ok: true, actor };

  // No usable `users` identity. Distinguish an unlinked legacy staff member
  // from someone who is not staff at all, so the denial is actionable.
  const legacy = await panelQuery<{ status: string | null }>(
    `SELECT status FROM mail_staff_user WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [email],
  );
  if (legacy[0]) {
    return { ok: false, reason: legacy[0].status === "active" ? "staff_not_linked" : "inactive" };
  }

  return { ok: false, reason: "not_staff" };
};

export const loadSupportReplyMacros = async (limit = 8): Promise<SupportReplyMacro[]> => {
  if (!isPanelDbConfigured()) return [];
  const rows = await panelQuery<{
    body: string;
    usagecount: string;
    lastusedat: string | null;
  }>(
    `SELECT content AS body,
            COUNT(*)::text AS usagecount,
            MAX("createdAt")::text AS lastusedat
       FROM chat_messages
      WHERE "authorType" = 'agent'
        AND COALESCE(is_internal, FALSE) = FALSE
        AND LENGTH(TRIM(COALESCE(content, ''))) > 0
      GROUP BY content
      ORDER BY MAX("createdAt") DESC
      LIMIT $1`,
    [limit],
  );

  return rows.map((row, index) => ({
    id: `macro-${index + 1}`,
    body: row.body,
    usageCount: Number(row.usagecount) || 0,
    lastUsedAt: row.lastusedat,
  }));
};
