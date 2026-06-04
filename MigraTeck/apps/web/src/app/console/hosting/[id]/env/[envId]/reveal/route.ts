import { NextResponse, type NextRequest } from "next/server";

import { getSession } from "../../../../../lib/auth";
import { loadWebsiteEnvVarSecret } from "../../../../../lib/modules/hosting-actions";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string; envId: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id, envId } = await context.params;
  if (!id || !envId) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const value = await loadWebsiteEnvVarSecret(id, envId);
  if (value === null) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ id: envId, websiteId: id, value });
}