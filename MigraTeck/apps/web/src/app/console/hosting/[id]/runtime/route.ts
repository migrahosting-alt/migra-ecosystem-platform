import { NextResponse, type NextRequest } from "next/server";

import { getSession } from "../../../lib/auth";
import {
  AVAILABLE_HOSTING_RUNTIMES,
  loadWebsiteTenantId,
  queueRuntimeChange,
} from "../../../lib/modules/hosting-actions";

export const dynamic = "force-dynamic";

export async function PATCH(
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

  let payload: { runtime?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const runtime = typeof payload.runtime === "string" ? payload.runtime.trim() : "";
  if (!AVAILABLE_HOSTING_RUNTIMES.includes(runtime as (typeof AVAILABLE_HOSTING_RUNTIMES)[number])) {
    return NextResponse.json({ error: "invalid_runtime" }, { status: 400 });
  }

  const tenantId = await loadWebsiteTenantId(id);
  if (!tenantId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await queueRuntimeChange(tenantId, id, runtime, { actorUserId: session.email });
  return NextResponse.json({ queued: true, websiteId: id, runtime });
}