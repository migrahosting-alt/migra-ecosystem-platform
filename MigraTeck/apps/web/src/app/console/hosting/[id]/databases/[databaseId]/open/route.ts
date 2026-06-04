import { NextResponse, type NextRequest } from "next/server";

import { getSession } from "../../../../../lib/auth";
import { loadWebsiteDatabaseManagerUrl } from "../../../../../lib/modules/hosting-actions";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string; databaseId: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id, databaseId } = await context.params;
  if (!id || !databaseId) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const destination = await loadWebsiteDatabaseManagerUrl(id, databaseId);
  if (!destination) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.redirect(new URL(destination, req.url));
}