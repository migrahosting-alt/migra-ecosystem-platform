import { NextResponse, type NextRequest } from "next/server";

import { getSession } from "../../../../lib/auth";
import {
  deleteWebsiteCronJob,
  loadWebsiteCronJobContext,
  upsertWebsiteCronJob,
} from "../../../../lib/modules/hosting-actions";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string; jobId: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id, jobId } = await context.params;
  if (!id || !jobId) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const current = await loadWebsiteCronJobContext(id, jobId);
  if (!current) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
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

  const updatedJobId = await upsertWebsiteCronJob(
    current.tenantId,
    id,
    { id: jobId, type, name, schedule, command, status },
    { actorUserId: session.email },
  );
  if (!updatedJobId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ id: updatedJobId, websiteId: id, type, name, status });
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string; jobId: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id, jobId } = await context.params;
  if (!id || !jobId) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const current = await loadWebsiteCronJobContext(id, jobId);
  if (!current) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const deleted = await deleteWebsiteCronJob(current.tenantId, id, jobId, { actorUserId: session.email });
  if (!deleted) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ deleted: true, id: jobId, websiteId: id });
}