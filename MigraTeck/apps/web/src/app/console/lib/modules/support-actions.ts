"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { panelExec, panelQuery } from "../db";
import { getSession } from "../auth";
import { loadSupportActor } from "./support";

const str = (fd: FormData, key: string) => String(fd.get(key) || "");
const isGuardianConversation = async (id: string) => {
  const rows = await panelQuery<{ id: string }>(`SELECT id FROM chat_conversations WHERE id = $1 LIMIT 1`, [id]);
  return rows.length > 0;
};
const guardianAgent = async (id: string) => {
  const rows = await panelQuery<{ id: string; name: string }>(
    `SELECT id,
            COALESCE(display_name, NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), ''), email) AS name
       FROM users
      WHERE id = $1
        AND role IN ('admin','support','agent','super_admin','ops')
        AND COALESCE(is_active, TRUE) = TRUE
      LIMIT 1`,
    [id],
  );
  return rows[0] || null;
};
const assignGuardianConversation = async (id: string, actor: { id: string; name: string }) => {
  const current = await panelQuery<{ assigneeid: string | null }>(
    `SELECT "assignedUserId" AS assigneeid FROM chat_conversations WHERE id = $1 LIMIT 1`,
    [id],
  );
  await panelExec(
    `UPDATE chat_conversations
        SET "assignedUserId" = $2,
            status = 'assigned',
            mode = 'human',
            "lastMessageAt" = NOW(),
            "updatedAt" = NOW()
      WHERE id = $1`,
    [id, actor.id],
  );
  if (current[0]?.assigneeid !== actor.id) {
    await panelExec(
      `INSERT INTO chat_messages
         (id, "conversationId", "authorType", "authorUserId", content, is_internal, message_type, "createdAt")
       VALUES ($1, $2, 'system', $3, $4, FALSE, 'system_event', NOW())`,
      [randomUUID(), id, actor.id, `Connected to live agent: ${actor.name}`],
    );
  }
};
const revalidateSupportPath = (ticketId: string, redirectTo: string) => {
  revalidatePath("/console/support");
  if (redirectTo.startsWith("/console/clients/")) revalidatePath(redirectTo);
  revalidatePath(`/console/support/${ticketId}/edit`);
};

export async function quickUpdateTicket(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const status = str(formData, "status").trim();
  const assignedTo = str(formData, "assignedTo").trim() || null;
  const redirectTo = str(formData, "redirectTo").trim() || "/console/support";
  if (!id || !status) return;

  if (await isGuardianConversation(id)) {
    await panelExec(
      `UPDATE chat_conversations
          SET status = $2,
              "assignedUserId" = COALESCE($3, "assignedUserId"),
              "updatedAt" = NOW(),
              closed_at = CASE WHEN $2 IN ('resolved','closed') THEN COALESCE(closed_at, NOW()) ELSE NULL END,
              resolved_at = CASE WHEN $2 = 'resolved' THEN COALESCE(resolved_at, NOW()) ELSE NULL END
        WHERE id = $1`,
      [id, status, assignedTo],
    );
    revalidateSupportPath(id, redirectTo);
    return;
  }

  await panelExec(
    `UPDATE chat_tickets
        SET status = $2,
            assigned_to = COALESCE($3, assigned_to),
            updated_at = NOW(),
            closed_at = CASE WHEN $2 IN ('resolved','closed') THEN COALESCE(closed_at, NOW()) ELSE NULL END
      WHERE id = $1`,
    [id, status, assignedTo],
  );
  revalidateSupportPath(id, redirectTo);
}

export async function claimTicket(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const redirectTo = str(formData, "redirectTo").trim() || "/console/support";
  if (!id) return;

  const actorEmail = (await getSession())?.email || "";
  const actor = await loadSupportActor(actorEmail);
  if (!actor) return;

  if (await isGuardianConversation(id)) {
    await assignGuardianConversation(id, actor);
    revalidateSupportPath(id, redirectTo);
    return;
  }

  await panelExec(
    `UPDATE chat_tickets
        SET assigned_to = $2,
            status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END,
            updated_at = NOW()
      WHERE id = $1`,
    [id, actor.id],
  );
  revalidateSupportPath(id, redirectTo);
}

export async function assignTicket(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const assignedTo = str(formData, "assignedTo").trim();
  const redirectTo = str(formData, "redirectTo").trim() || "/console/support";
  if (!id || !assignedTo) return;

  const agent = await guardianAgent(assignedTo);
  if (!agent) return;

  if (await isGuardianConversation(id)) {
    await assignGuardianConversation(id, agent);
  } else {
    await panelExec(
      `UPDATE chat_tickets
          SET assigned_to = $2,
              status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END,
              updated_at = NOW()
        WHERE id = $1`,
      [id, agent.id],
    );
  }
  revalidateSupportPath(id, redirectTo);
}

export async function addInternalTicketNote(formData: FormData): Promise<void> {
  const ticketId = str(formData, "ticketId");
  const body = str(formData, "body").trim();
  const redirectTo = str(formData, "redirectTo").trim() || `/console/support/${ticketId}/edit`;
  if (!ticketId || !body) return;

  const session = await getSession();
  const actor = session?.email ? await loadSupportActor(session.email) : null;
  // Fail closed: never write support content under an unresolved identity.
  if (!actor) return;

  if (await isGuardianConversation(ticketId)) {
    await panelExec(
      `INSERT INTO chat_messages
         (id, "conversationId", "authorType", "authorUserId", content, is_internal, message_type, "createdAt")
       VALUES ($1, $2, 'agent', $3, $4, TRUE, 'internal_note', NOW())`,
      [randomUUID(), ticketId, actor.id, body],
    );
    await panelExec(`UPDATE chat_conversations SET "updatedAt" = NOW() WHERE id = $1`, [ticketId]);
    revalidateSupportPath(ticketId, redirectTo);
    return;
  }

  await panelExec(
    `INSERT INTO chat_ticket_messages
       (id, ticket_id, sender, sender_name, body, is_internal, ai_generated, created_at)
     VALUES ($1, $2, 'admin', $3, $4, TRUE, FALSE, NOW())`,
    [randomUUID(), ticketId, actor.name, body],
  );
  await panelExec(`UPDATE chat_tickets SET updated_at = NOW() WHERE id = $1`, [ticketId]);
  revalidateSupportPath(ticketId, redirectTo);
}

export async function sendSupportReply(formData: FormData): Promise<void> {
  const ticketId = str(formData, "ticketId");
  const body = str(formData, "body").trim();
  const redirectTo = str(formData, "redirectTo").trim() || `/console/support?ticketId=${ticketId}`;
  if (!ticketId || !body) return;

  const session = await getSession();
  const actor = session?.email ? await loadSupportActor(session.email) : null;
  // Fail closed. This sends a CUSTOMER-VISIBLE message; it must never go out
  // under a null author or a substituted identity.
  if (!actor) return;

  if (await isGuardianConversation(ticketId)) {
    const now = new Date();
    await assignGuardianConversation(ticketId, actor);
    await panelExec(
      `INSERT INTO chat_messages
         (id, "conversationId", "authorType", "authorUserId", content, is_internal, message_type, "createdAt")
       VALUES ($1, $2, 'agent', $3, $4, FALSE, 'message', $5)`,
      [randomUUID(), ticketId, actor.id, body, now],
    );
    await panelExec(
      `UPDATE chat_conversations
          SET "lastMessageAt" = $2,
              "updatedAt" = $2,
              status = 'waiting_on_customer',
              mode = 'human',
              "assignedUserId" = COALESCE($3, "assignedUserId"),
              last_staff_reply_at = $2,
              first_response_at = COALESCE(first_response_at, $2)
        WHERE id = $1`,
      [ticketId, now, actor.id],
    );
    revalidateSupportPath(ticketId, redirectTo);
    return;
  }

  await panelExec(
    `INSERT INTO chat_ticket_messages
       (id, ticket_id, sender, sender_name, body, is_internal, ai_generated, created_at)
     VALUES ($1, $2, 'admin', $3, $4, FALSE, FALSE, NOW())`,
    [randomUUID(), ticketId, actor.name, body],
  );

  await panelExec(
    `UPDATE chat_tickets
        SET updated_at = NOW(),
            status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END,
            first_response_at = COALESCE(first_response_at, NOW())
      WHERE id = $1`,
    [ticketId],
  );
  revalidateSupportPath(ticketId, redirectTo);
}

export async function updateTicketDetail(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const subject = str(formData, "subject").trim();
  const department = str(formData, "department").trim() || "Support";
  const status = str(formData, "status").trim() || "open";
  const priority = str(formData, "priority").trim() || "normal";
  const assignedTo = str(formData, "assignedTo").trim() || null;
  const customerName = str(formData, "customerName").trim() || null;
  const customerEmail = str(formData, "customerEmail").trim() || null;
  const tags = str(formData, "tags").trim();
  const redirectTo = str(formData, "redirectTo").trim() || "/console/support";
  if (!id || !subject) return;

  const normalizedTags = JSON.stringify(
    tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
  );

  if (await isGuardianConversation(id)) {
    await panelExec(
      `UPDATE chat_conversations
          SET subject = $2,
              department = $3,
              status = $4,
              priority = $5,
              "assignedUserId" = $6,
              "visitorName" = $7,
              "visitorEmail" = $8,
              "updatedAt" = NOW(),
              closed_at = CASE WHEN $4 IN ('resolved','closed') THEN COALESCE(closed_at, NOW()) ELSE NULL END,
              resolved_at = CASE WHEN $4 = 'resolved' THEN COALESCE(resolved_at, NOW()) ELSE NULL END
        WHERE id = $1`,
      [id, subject, department, status, priority, assignedTo, customerName, customerEmail],
    );
    revalidateSupportPath(id, redirectTo);
    return;
  }

  await panelExec(
    `UPDATE chat_tickets
        SET subject = $2,
            department = $3,
            status = $4,
            priority = $5,
            assigned_to = $6,
            customer_name = $7,
            customer_email = $8,
            tags = $9,
            updated_at = NOW(),
            closed_at = CASE WHEN $4 IN ('resolved','closed') THEN COALESCE(closed_at, NOW()) ELSE NULL END
      WHERE id = $1`,
    [id, subject, department, status, priority, assignedTo, customerName, customerEmail, normalizedTags],
  );
  revalidateSupportPath(id, redirectTo);
}

export async function closeTicket(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const redirectTo = str(formData, "redirectTo").trim() || "/console/support";
  if (!id) return;
  if (await isGuardianConversation(id)) {
    await panelExec(
      `UPDATE chat_conversations
          SET status = 'closed',
              closed_at = COALESCE(closed_at, NOW()),
              "lastMessageAt" = NOW(),
              "updatedAt" = NOW()
        WHERE id = $1`,
      [id],
    );
    revalidateSupportPath(id, redirectTo);
    return;
  }
  await panelExec(
    `UPDATE chat_tickets
        SET status = 'closed',
            closed_at = COALESCE(closed_at, NOW()),
            updated_at = NOW()
      WHERE id = $1`,
    [id],
  );
  revalidateSupportPath(id, redirectTo);
}

export async function loadSupportAgentsForForm() {
  return panelQuery<{ id: string; name: string }>(
    `SELECT id,
            COALESCE(display_name, NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), ''), email) AS name
       FROM users
      WHERE role IN ('admin','support','agent','super_admin','ops')
        AND COALESCE(is_active, TRUE) = TRUE
      ORDER BY name ASC
      LIMIT 50`,
  );
}
