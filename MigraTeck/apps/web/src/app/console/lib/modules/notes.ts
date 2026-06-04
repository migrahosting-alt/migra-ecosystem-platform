import { randomUUID } from "node:crypto";
import { panelExec, panelQuery, isPanelDbConfigured } from "../db";

export type ClientNote = {
  id: string;
  tenantId: string;
  authorEmail: string | null;
  body: string;
  pinned: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export const loadClientNotes = async (tenantId: string): Promise<ClientNote[]> => {
  if (!isPanelDbConfigured() || !tenantId) return [];
  const rows = await panelQuery<{
    id: string;
    tenant_id: string;
    author_email: string | null;
    body: string;
    pinned: boolean;
    created_at: string | null;
    updated_at: string | null;
  }>(
    `SELECT id, tenant_id, author_email, body, pinned,
            created_at::text AS created_at,
            updated_at::text AS updated_at
       FROM client_notes
      WHERE tenant_id = $1 AND deleted_at IS NULL
      ORDER BY pinned DESC, created_at DESC
      LIMIT 100`,
    [tenantId],
  );
  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    authorEmail: r.author_email,
    body: r.body,
    pinned: !!r.pinned,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
};

export const createClientNote = async (input: {
  tenantId: string;
  authorEmail: string | null;
  body: string;
  pinned?: boolean;
}): Promise<string> => {
  const id = randomUUID();
  await panelExec(
    `INSERT INTO client_notes (id, tenant_id, author_email, body, pinned, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
    [id, input.tenantId, input.authorEmail, input.body, !!input.pinned],
  );
  return id;
};

export const deleteClientNote = async (noteId: string): Promise<void> => {
  await panelExec(
    `UPDATE client_notes SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [noteId],
  );
};

export const togglePinNote = async (noteId: string, pinned: boolean): Promise<void> => {
  await panelExec(
    `UPDATE client_notes SET pinned = $2, updated_at = NOW() WHERE id = $1`,
    [noteId, pinned],
  );
};
