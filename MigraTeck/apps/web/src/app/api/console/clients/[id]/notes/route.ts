import { requireSession, jsonOk, jsonError, parseJson } from "../../../../../console/lib/api-helpers";
import {
  loadClientNotes,
  createClientNote,
  withAuditedAction,
} from "../../../../../console/lib/modules";

export const dynamic = "force-dynamic";

type CreateBody = {
  body: string;
  pinned?: boolean;
};

/** GET /api/console/clients/:id/notes — list notes for this tenant. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!id) return jsonError(400, "missing_id");
  const notes = await loadClientNotes(id);
  return jsonOk({ data: notes, count: notes.length });
}

/** POST /api/console/clients/:id/notes — { body, pinned? } */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!id) return jsonError(400, "missing_id");

  const body = await parseJson<CreateBody>(req);
  const text = (body?.body || "").trim();
  if (!text) return jsonError(400, "missing_body");

  let noteId: string | null = null;
  const result = await withAuditedAction({
    tenantId: id,
    actor: auth.session.email,
    action: "note.add",
    resource: "note",
    metadata: { pinned: !!body?.pinned, length: text.length },
    run: async () => {
      noteId = await createClientNote({
        tenantId: id,
        authorEmail: auth.session.email,
        body: text,
        pinned: !!body?.pinned,
      });
    },
  });

  if (!result.ok) return jsonError(500, result.error || "create_failed");
  return jsonOk({ ok: true, id: noteId }, { status: 201 });
}
