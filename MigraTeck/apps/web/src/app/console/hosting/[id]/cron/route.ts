import { NextResponse, type NextRequest } from "next/server";

import { getSession } from "../../../lib/auth";
import { loadWebsiteTenantId, upsertWebsiteCronJob } from "../../../lib/modules/hosting-actions";

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

  let payload: { type?: unknown; name?: unknown; schedule?: unknown; command?: unknown; status?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const type = typeof payload.type === "string" ? payload.type.trim() : "";
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const schedule = typeof payload.schedule === "string" ? payload.schedule.trim() || null : null;
  const command = typeof payload.command === "string" ? payload.command.trim() || null : null;
  const status = typeof payload.status === "string" ? payload.status.trim() || "active" : "active";
  if (!type || !name) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const tenantId = await loadWebsiteTenantId(id);
  if (!tenantId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const jobId = await upsertWebsiteCronJob(
    tenantId,
    id,
    { type, name, schedule, command, status },
    { actorUserId: session.email },
  );
  return NextResponse.json({ id: jobId, websiteId: id, type, name, status });
}