import { NextResponse, type NextRequest } from "next/server";

import { getSession } from "../../../../lib/auth";
import { loadAndDeleteWebsiteSftpPasswordReveal } from "../../../../lib/modules/hosting-actions";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
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

  const reveal = await loadAndDeleteWebsiteSftpPasswordReveal(id);
  if (!reveal) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({
    id: reveal.id,
    websiteId: id,
    password: reveal.password,
    createdAt: reveal.createdAt,
  });
}