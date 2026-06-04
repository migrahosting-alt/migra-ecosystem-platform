import { NextRequest } from "next/server";
import { requireSession, jsonOk, jsonError } from "../../../../../console/lib/api-helpers";
import { loadClientTimeline } from "../../../../../console/lib/modules";

export const dynamic = "force-dynamic";

/** GET /api/console/clients/:id/timeline?limit=50 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!id) return jsonError(400, "missing_id");

  const limitRaw = req.nextUrl.searchParams.get("limit");
  const limit = limitRaw ? Math.max(1, Math.min(parseInt(limitRaw, 10) || 50, 500)) : 50;

  const events = await loadClientTimeline(id, limit);
  return jsonOk({ data: events, count: events.length });
}
