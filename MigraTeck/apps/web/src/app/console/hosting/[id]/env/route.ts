import { NextResponse, type NextRequest } from "next/server";

import { getSession } from "../../../lib/auth";
import { loadWebsiteTenantId, upsertWebsiteEnvVar } from "../../../lib/modules/hosting-actions";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  let payload: { key?: unknown; value?: unknown; isSecret?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const key = typeof payload.key === "string" ? payload.key.trim() : "";
  const value = typeof payload.value === "string" ? payload.value : "";
  const isSecret = typeof payload.isSecret === "boolean" ? payload.isSecret : true;
  if (!key || !value) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const tenantId = await loadWebsiteTenantId(id);
  if (!tenantId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const envId = await upsertWebsiteEnvVar(tenantId, id, { key, value, isSecret }, { actorUserId: session.email });
  return NextResponse.json({ id: envId, websiteId: id, key, isSecret });
}