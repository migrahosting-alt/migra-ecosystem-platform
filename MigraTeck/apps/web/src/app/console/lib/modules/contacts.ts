import { randomUUID } from "node:crypto";
import { panelExec, panelQuery, isPanelDbConfigured } from "../db";

export const CONTACT_ROLES = ["primary", "billing", "technical", "escalation"] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];

export type ClientContact = {
  id: string;
  tenantId: string;
  role: ContactRole;
  name: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  notes: string | null;
  isDefault: boolean;
  createdAt: string | null;
};

const normalizeRole = (r: string | null | undefined): ContactRole => {
  const v = (r || "primary").toLowerCase();
  return (CONTACT_ROLES as readonly string[]).includes(v) ? (v as ContactRole) : "primary";
};

export const loadClientContacts = async (tenantId: string): Promise<ClientContact[]> => {
  if (!isPanelDbConfigured() || !tenantId) return [];
  const rows = await panelQuery<{
    id: string;
    tenant_id: string;
    role: string | null;
    name: string | null;
    email: string | null;
    phone: string | null;
    title: string | null;
    notes: string | null;
    is_default: boolean | null;
    created_at: string | null;
  }>(
    `SELECT id, tenant_id, role, name, email, phone, title, notes,
            is_default, created_at::text AS created_at
       FROM client_contacts
      WHERE tenant_id = $1 AND deleted_at IS NULL
      ORDER BY is_default DESC, role ASC, created_at ASC`,
    [tenantId],
  );
  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    role: normalizeRole(r.role),
    name: r.name,
    email: r.email,
    phone: r.phone,
    title: r.title,
    notes: r.notes,
    isDefault: !!r.is_default,
    createdAt: r.created_at,
  }));
};

export const createClientContact = async (input: {
  tenantId: string;
  role: ContactRole;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  notes?: string | null;
  isDefault?: boolean;
}): Promise<string> => {
  const id = randomUUID();
  await panelExec(
    `INSERT INTO client_contacts
       (id, tenant_id, role, name, email, phone, title, notes, is_default, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
    [
      id,
      input.tenantId,
      input.role,
      input.name ?? null,
      input.email ?? null,
      input.phone ?? null,
      input.title ?? null,
      input.notes ?? null,
      !!input.isDefault,
    ],
  );
  return id;
};

export const updateClientContact = async (input: {
  id: string;
  role: ContactRole;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  notes?: string | null;
  isDefault?: boolean;
}): Promise<void> => {
  await panelExec(
    `UPDATE client_contacts
        SET role = $2, name = $3, email = $4, phone = $5, title = $6,
            notes = $7, is_default = $8, updated_at = NOW()
      WHERE id = $1`,
    [
      input.id,
      input.role,
      input.name ?? null,
      input.email ?? null,
      input.phone ?? null,
      input.title ?? null,
      input.notes ?? null,
      !!input.isDefault,
    ],
  );
};

export const deleteClientContact = async (id: string): Promise<void> => {
  await panelExec(
    `UPDATE client_contacts SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [id],
  );
};
