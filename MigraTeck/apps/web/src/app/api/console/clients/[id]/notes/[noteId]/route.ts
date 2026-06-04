import { requireSession, jsonOk, jsonError, parseJson } from "../../../../../../console/lib/api-helpers";
import {
  deleteClientNote,
  togglePinNote,
  withAuditedAction,
} from "../../../../../../console/lib/modules";

export const dynamic = "force-dynamic";

type PatchBody = { pinned?: boolean };

/** DELETE /api/console/clients/:id/notes/:noteId */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; noteId: string }> },
) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { id, noteId } = await ctx.params;
  if (!id || !noteId) return jsonError(400, "missing_ids");

  const result = await withAuditedAction({
    tenantId: id,
    actor: auth.session.email,
    action: "note.delete",
    resource: "note",
    resourceId: noteId,
    run: async () => {
      await deleteClientNote(noteId);
    },
  });

  if (!result.ok) return jsonError(500, result.error || "delete_failed");
  return jsonOk({ ok: true });
}

/** PATCH /api/console/clients/:id/notes/:noteId  body: { pinned: true|false } */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; noteId: string }> },
) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { id, noteId } = await ctx.params;
  if (!id || !noteId) return jsonError(400, "missing_ids");

  const body = await parseJson<PatchBody>(req);
  if (body?.pinned === undefined) return jsonError(400, "missing_pinned");

  const result = await withAuditedAction({
    tenantId: id,
    actor: auth.session.email,
    action: body.pinned ? "note.pin" : "note.unpin",
    resource: "note",
    resourceId: noteId,
    run: async () => {
      await togglePinNote(noteId, !!body.pinned);
    },
  });

  if (!result.ok) return jsonError(500, result.error || "patch_failed");
  return jsonOk({ ok: true, pinned: !!body.pinned });
}
