import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { getSession } from "../../../../lib/auth";
import { panelExec, panelQuery } from "../../../../lib/db";
import { loadSupportActor } from "../../../../lib/modules/support";

const typingActiveMs = 3_000;

const requireActor = async () => {
  const session = await getSession();
  return session?.email ? loadSupportActor(session.email) : null;
};

const audit = async (conversationId: string, actor: { id: string; name: string }, eventType: string, fromState?: string | null, toState?: string | null, metadata: Record<string, unknown> = {}) => {
  await panelExec(
    `INSERT INTO support_conversation_audit
       (id, conversation_id, tenant_id, actor_user_id, actor_label, event_type, from_state, to_state, metadata_json)
     SELECT $1, c.id, c."tenantId", $2, $3, $4, $5, $6, $7::jsonb
       FROM chat_conversations c WHERE c.id = $8`,
    [randomUUID(), actor.id, actor.name, eventType, fromState || null, toState || null, JSON.stringify(metadata), conversationId],
  );
};

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  if (!actor) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const since = request.nextUrl.searchParams.get("since");
  const [conversation, messages] = await Promise.all([
    panelQuery<{ clienttypingat: string | null; customername: string | null; assignmentstate: string; status: string; assigneeid: string | null; assigneename: string | null; assigneeemail: string | null; claimedat: string | null; acceptedat: string | null; endedat: string | null; resolutioncategory: string | null; rating: number | null; issueresolved: boolean | null; feedback: string | null }>(
      `SELECT NULLIF("metadataJson"->>'clientTypingAt', '') AS clienttypingat,
              COALESCE(c."visitorName", 'Customer') AS customername,
              c.assignment_state AS assignmentstate, c.status,
              c."assignedUserId" AS assigneeid,
              CASE
                WHEN c."assignedUserId" IS NULL THEN NULL
                ELSE COALESCE(u.display_name, NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), 'Support')
              END AS assigneename,
              u.email AS assigneeemail, c.claimed_at::text AS claimedat,
              c.accepted_at::text AS acceptedat, c.ended_at::text AS endedat,
              c.resolution_category AS resolutioncategory,
              r.rating, r.issue_resolved AS issueresolved, r.feedback
         FROM chat_conversations c
         LEFT JOIN users u ON u.id = c."assignedUserId"
         LEFT JOIN support_conversation_ratings r ON r.conversation_id = c.id
        WHERE c.id = $1 LIMIT 1`,
      [id],
    ),
    panelQuery<{
      id: string;
      sender: string;
      sendername: string | null;
      body: string;
      isinternal: boolean | null;
      aigenerated: boolean | null;
      createdat: string;
      deliverystate: string;
      deliveredat: string | null;
      readat: string | null;
    }>(
      `SELECT m.id,
              CASE WHEN m."authorType" = 'agent' THEN 'admin'
                   WHEN m."authorType" = 'assistant' THEN 'ai'
                   WHEN m."authorType" IN ('visitor','client') THEN 'customer'
                   ELSE m."authorType" END AS sender,
              CASE WHEN m."authorType" = 'assistant' THEN 'Abigail'
                   WHEN m."authorType" = 'agent' THEN COALESCE(u.display_name, NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), 'Support')
                   WHEN m."authorType" IN ('visitor','client') THEN COALESCE(c."visitorName", 'Customer')
                   ELSE 'System' END AS sendername,
              m.content AS body, COALESCE(m.is_internal, FALSE) AS isinternal,
              (m."authorType" = 'assistant') AS aigenerated, m."createdAt"::text AS createdat,
              m.delivery_state AS deliverystate, m.delivered_at::text AS deliveredat, m.read_at::text AS readat
         FROM chat_messages m
         JOIN chat_conversations c ON c.id = m."conversationId"
         LEFT JOIN users u ON u.id = m."authorUserId"
        WHERE m."conversationId" = $1
          AND ($2::timestamptz IS NULL OR m."createdAt" >= $2::timestamptz)
        ORDER BY m."createdAt" ASC, m.id ASC LIMIT 500`,
      [id, since || null],
    ),
  ]);
  if (!conversation[0]) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  await panelExec(
    `UPDATE chat_messages SET delivery_state = 'read', delivered_at = COALESCE(delivered_at, NOW()), read_at = COALESCE(read_at, NOW())
      WHERE "conversationId" = $1 AND "authorType" IN ('visitor','client') AND read_at IS NULL`,
    [id],
  );

  const clientTypingAt = Number(conversation[0].clienttypingat || 0);
  return NextResponse.json({
    ok: true,
    clientName: conversation[0].customername,
    clientTyping: clientTypingAt > Date.now() - typingActiveMs,
    actor: { id: actor.id, name: actor.name },
    conversation: conversation[0],
    messages,
  });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  if (!actor) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const body = await request.json().catch(() => ({})) as { action?: string; message?: string; clientMessageId?: string; assignedTo?: string; department?: string; reason?: string; resolutionCategory?: string; resolutionNote?: string };
  if (body.action === "typing" || body.action === "typing-stop") {
    await panelExec(
      `UPDATE chat_conversations
          SET "metadataJson" = COALESCE("metadataJson", '{}'::jsonb)
                               || jsonb_build_object('supportTypingAt', $2::bigint),
              "updatedAt" = NOW()
        WHERE id = $1`,
      [id, body.action === "typing" ? Date.now() : 0],
    );
    return NextResponse.json({ ok: true });
  }
  if (body.action === "presence") {
    await panelExec(
      `INSERT INTO chat_agent_presence (admin_id, admin_name, status, capacity, active_chats, last_seen, updated_at)
       VALUES ($1, $2, 'available', 4,
         (SELECT COUNT(*)::int FROM chat_conversations WHERE "assignedUserId" = $1 AND assignment_state IN ('claimed','active','waiting_on_customer','waiting_on_support')),
         NOW(), NOW())
       ON CONFLICT (admin_id) DO UPDATE SET admin_name = EXCLUDED.admin_name,
         active_chats = EXCLUDED.active_chats,
         status = CASE WHEN EXCLUDED.active_chats >= chat_agent_presence.capacity THEN 'busy' ELSE 'available' END,
         last_seen = NOW(), updated_at = NOW()`,
      [actor.id, actor.name],
    );
    return NextResponse.json({ ok: true });
  }

  const currentRows = await panelQuery<{ state: string; assigneeid: string | null; status: string }>(
    `SELECT assignment_state AS state, "assignedUserId" AS assigneeid, status FROM chat_conversations WHERE id = $1 LIMIT 1`,
    [id],
  );
  const current = currentRows[0];
  if (!current) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  if (body.action === "claim") {
    const claimed = await panelQuery<{ id: string }>(
      `UPDATE chat_conversations
          SET "assignedUserId" = $2, assignment_state = 'claimed', status = 'claimed', mode = 'human',
              claimed_at = NOW(), "updatedAt" = NOW()
        WHERE id = $1 AND "assignedUserId" IS NULL
          AND assignment_state IN ('unassigned','waiting_for_agent','reopened')
      RETURNING id`,
      [id, actor.id],
    );
    if (!claimed[0]) return NextResponse.json({ ok: false, error: "already_claimed" }, { status: 409 });
    await audit(id, actor, "claimed", current.state, "claimed");
    return NextResponse.json({ ok: true, state: "claimed" });
  }

  if (body.action === "accept") {
    const accepted = await panelQuery<{ id: string }>(
      `UPDATE chat_conversations
          SET assignment_state = 'active', status = 'active', accepted_at = COALESCE(accepted_at, NOW()),
              "metadataJson" = COALESCE("metadataJson", '{}'::jsonb) || jsonb_build_object('supportTypingAt', 0),
              "updatedAt" = NOW()
        WHERE id = $1 AND "assignedUserId" = $2 AND assignment_state = 'claimed'
      RETURNING id`,
      [id, actor.id],
    );
    if (!accepted[0]) return NextResponse.json({ ok: false, error: "claim_required" }, { status: 409 });
    await panelExec(
      `INSERT INTO chat_messages (id, "conversationId", "authorType", "authorUserId", content, is_internal, message_type, "createdAt")
       VALUES ($1, $2, 'system', $3, $4, FALSE, 'agent_joined', NOW())`,
      [randomUUID(), id, actor.id, `${actor.name.includes("@") ? "Support" : actor.name} has joined the conversation.`],
    );
    await audit(id, actor, "accepted", "claimed", "active");
    return NextResponse.json({ ok: true, state: "active" });
  }

  if (body.action === "transfer" || body.action === "reassign") {
    const assignee = String(body.assignedTo || "");
    const target = await panelQuery<{ id: string; name: string }>(
      `SELECT id, COALESCE(display_name, NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), ''), 'Support') AS name
         FROM users u
         LEFT JOIN chat_agent_presence p ON p.admin_id = u.id AND p.last_seen >= NOW() - INTERVAL '2 minutes'
        WHERE u.id = $1 AND u.role IN ('admin','support','agent','super_admin','ops') AND COALESCE(u.is_active, TRUE)
          AND COALESCE(p.status, 'offline') IN ('online','available','busy')
          AND COALESCE(p.active_chats, 0) < COALESCE(p.capacity, 4)
        LIMIT 1`,
      [assignee],
    );
    if (!target[0]) return NextResponse.json({ ok: false, error: "invalid_assignee" }, { status: 400 });
    await panelExec(
      `UPDATE chat_conversations SET "assignedUserId" = $2, assignment_state = 'claimed', status = 'claimed',
              claimed_at = NOW(), accepted_at = NULL,
              "metadataJson" = COALESCE("metadataJson", '{}'::jsonb) || jsonb_build_object('supportTypingAt', 0),
              department = COALESCE(NULLIF($3, ''), department), "updatedAt" = NOW()
        WHERE id = $1`,
      [id, target[0].id, String(body.department || "")],
    );
    await panelExec(
      `INSERT INTO chat_transfer_history (id, ticket_id, from_agent, to_agent, reason, department)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), id, current.assigneeid, target[0].id, String(body.reason || "Transferred by supervisor"), String(body.department || "support")],
    );
    await audit(id, actor, body.action, current.state, "claimed", { toAgentId: target[0].id, reason: body.reason || null });
    return NextResponse.json({ ok: true, state: "claimed" });
  }

  if (body.action === "resolve" || body.action === "end") {
    const nextState = body.action === "resolve" ? "resolved" : "ended";
    await panelExec(
      `UPDATE chat_conversations
          SET assignment_state = $2, status = $2,
              resolved_at = CASE WHEN $2 = 'resolved' THEN NOW() ELSE resolved_at END,
              closed_at = NOW(), ended_at = NOW(), ended_by = $3,
              "metadataJson" = COALESCE("metadataJson", '{}'::jsonb) || jsonb_build_object('supportTypingAt', 0),
              resolution_category = NULLIF($4, ''), resolution_note = NULLIF($5, ''), "updatedAt" = NOW()
        WHERE id = $1`,
      [id, nextState, actor.id, String(body.resolutionCategory || ""), String(body.resolutionNote || "")],
    );
    await panelExec(
      `INSERT INTO chat_messages (id, "conversationId", "authorType", "authorUserId", content, is_internal, message_type, "createdAt")
       VALUES ($1, $2, 'system', $3, $4, FALSE, 'conversation_ended', NOW())`,
      [randomUUID(), id, actor.id, body.action === "resolve" ? "This conversation has been resolved." : "This conversation has ended."],
    );
    await audit(id, actor, body.action === "resolve" ? "resolved" : "ended", current.state, nextState, { category: body.resolutionCategory || null });
    return NextResponse.json({ ok: true, state: nextState });
  }

  if (body.action === "reopen") {
    await panelExec(
      `UPDATE chat_conversations SET assignment_state = 'reopened', status = 'open', mode = 'human', "assignedUserId" = NULL,
              "metadataJson" = COALESCE("metadataJson", '{}'::jsonb) || jsonb_build_object('supportTypingAt', 0),
              reopened_at = NOW(), ended_at = NULL, closed_at = NULL, "updatedAt" = NOW() WHERE id = $1`,
      [id],
    );
    await audit(id, actor, "reopened", current.state, "reopened");
    return NextResponse.json({ ok: true, state: "reopened" });
  }

  if (body.action === "internal-note") {
    const note = String(body.message || "").trim();
    if (!note) return NextResponse.json({ ok: false, error: "message_required" }, { status: 400 });
    await panelExec(
      `INSERT INTO chat_messages (id, "conversationId", "authorType", "authorUserId", content, is_internal, message_type, "createdAt")
       VALUES ($1, $2, 'agent', $3, $4, TRUE, 'internal_note', NOW())`,
      [randomUUID(), id, actor.id, note],
    );
    await audit(id, actor, "internal_note_added", current.state, current.state);
    return NextResponse.json({ ok: true });
  }

  const message = String(body.message || "").trim();
  if (!message) return NextResponse.json({ ok: false, error: "message_required" }, { status: 400 });
  const messageId = String(body.clientMessageId || randomUUID());
  const now = new Date();
  if (!current.assigneeid || current.assigneeid !== actor.id || ["resolved", "ended"].includes(current.state)) {
    return NextResponse.json({ ok: false, error: "active_assignment_required" }, { status: 409 });
  }
  await panelExec(
    `UPDATE chat_conversations
        SET "assignedUserId" = $2, status = 'waiting_on_customer', assignment_state = 'waiting_on_customer', mode = 'human',
            "lastMessageAt" = $3, last_staff_reply_at = $3,
            first_response_at = COALESCE(first_response_at, $3),
            "metadataJson" = COALESCE("metadataJson", '{}'::jsonb)
                                 || jsonb_build_object('supportTypingAt', 0),
            "updatedAt" = $3
      WHERE id = $1`,
    [id, actor.id, now],
  );
  await panelExec(
    `INSERT INTO chat_messages
       (id, "conversationId", "authorType", "authorUserId", content, is_internal, message_type, client_message_id, delivery_state, delivered_at, "createdAt")
     VALUES ($1, $2, 'agent', $3, $4, FALSE, 'message', $1, 'delivered', NOW(), $5::timestamp)
     ON CONFLICT (id) DO NOTHING`,
    [messageId, id, actor.id, message, now],
  );
  return NextResponse.json({ ok: true, message: { id: messageId, sender: "admin", sendername: actor.name, body: message, isinternal: false, aigenerated: false, createdat: now.toISOString() } });
}
