import { requireSession, jsonOk, jsonError, parseJson } from "../../../../../../console/lib/api-helpers";
import {
  updateClientContact,
  deleteClientContact,
  withAuditedAction,
  CONTACT_ROLES,
} from "../../../../../../console/lib/modules";
import type { ContactRole } from "../../../../../../console/lib/modules";

export const dynamic = "force-dynamic";

const normalizeRole = (raw: string | null | undefined): ContactRole => {
  const v = (raw || "primary").toLowerCase();
  return (CONTACT_ROLES as readonly string[]).includes(v) ? (v as ContactRole) : "primary";
};

type PatchBody = {
  role?: string;
  name?: string;
  email?: string;
  phone?: string;
  title?: string;
  notes?: string;
};

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; contactId: string }> },
) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { id, contactId } = await ctx.params;
  if (!id || !contactId) return jsonError(400, "missing_ids");

  const body = (await parseJson<PatchBody>(req)) || {};

  const result = await withAuditedAction({
    tenantId: id,
    actor: auth.session.email,
    action: "contact.update",
    resource: "contact",
    resourceId: contactId,
    run: async () => {
      await updateClientContact({
        id: contactId,
        role: normalizeRole(body.role),
        name: body.name?.trim() || null,
        email: body.email?.trim() || null,
        phone: body.phone?.trim() || null,
        title: body.title?.trim() || null,
        notes: body.notes?.trim() || null,
      });
    },
  });

  if (!result.ok) return jsonError(500, result.error || "patch_failed");
  return jsonOk({ ok: true });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; contactId: string }> },
) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { id, contactId } = await ctx.params;
  if (!id || !contactId) return jsonError(400, "missing_ids");

  const result = await withAuditedAction({
    tenantId: id,
    actor: auth.session.email,
    action: "contact.delete",
    resource: "contact",
    resourceId: contactId,
    run: async () => {
      await deleteClientContact(contactId);
    },
  });

  if (!result.ok) return jsonError(500, result.error || "delete_failed");
  return jsonOk({ ok: true });
}
