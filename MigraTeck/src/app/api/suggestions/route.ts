import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { listSuggestions, getActiveSuggestionCount } from "@/lib/suggestions";

export async function GET(request: NextRequest) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx) {
    return NextResponse.json({ error: "No active organization." }, { status: 403 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get("status") as "ACTIVE" | "DISMISSED" | "ACCEPTED" | "EXPIRED" | null;
  const limit = url.searchParams.get("limit");

  const [items, activeCount] = await Promise.all([
    listSuggestions(ctx.orgId, {
      ...(status ? { status } : {}),
      ...(limit ? { limit: parseInt(limit, 10) } : {}),
    }),
    getActiveSuggestionCount(ctx.orgId),
  ]);

  return NextResponse.json({ items, activeCount });
}
