import { requireSession, jsonOk, jsonError, parseJson } from "../../../../../console/lib/api-helpers";
import {
  loadClientContacts,
  createClientContact,
  withAuditedAction,
  CONTACT_ROLES,
} from "../../../../../console/lib/modules";
import type { ContactRole } from "../../../../../console/lib/modules";

export const dynamic = "force-dynamic";

const normalizeRole = (raw: string | null | undefined): ContactRole => {
  const v = (raw || "primary").toLowerCase();
  return (CONTACT_ROLES as readonly string[]).includes(v) ? (v as ContactRole) : "primary";
};

type CreateBody = {
  role?: string;
  name?: string;
  email?: string;
  phone?: string;
  title?: string;
  notes?: string;
};

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!id) return jsonError(400, "missing_id");
  const contacts = await loadClientContacts(id);
  return jsonOk({ data: contacts, count: contacts.length });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!id) return jsonError(400, "missing_id");

  const body = (await parseJson<CreateBody>(req)) || {};
  if (!body.name && !body.email && !body.phone) {
    return jsonError(400, "missing_fields", { need: ["name", "email", "phone"] });
  }

  let createdId: string | null = null;
  const result = await withAuditedAction({
    tenantId: id,
    actor: auth.session.email,
    action: "contact.add",
    resource: "contact",
    metadata: { role: normalizeRole(body.role), email: body.email, name: body.name },
    run: async () => {
      createdId = await createClientContact({
        tenantId: id,
        role: normalizeRole(body.role),
        name: body.name?.trim() || null,
        email: body.email?.trim() || null,
        phone: body.phone?.trim() || null,
        title: body.title?.trim() || null,
        notes: body.notes?.trim() || null,
      });
    },
  });

  if (!result.ok) return jsonError(500, result.error || "create_failed");
  return jsonOk({ ok: true, id: createdId }, { status: 201 });
}
