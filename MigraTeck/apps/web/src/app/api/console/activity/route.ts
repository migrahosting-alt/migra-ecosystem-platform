import { NextRequest } from "next/server";
import { requireSession, jsonOk } from "../../../console/lib/api-helpers";
import { loadAllRecentEvents } from "../../../console/lib/modules";

export const dynamic = "force-dynamic";

/** GET /api/console/activity?q=&action=&failures=1&limit=&offset= */
export async function GET(req: NextRequest) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const q = sp.get("q") || undefined;
  const action = sp.get("action") || undefined;
  const failuresOnly = sp.get("failures") === "1";
  const limit = Math.max(1, Math.min(parseInt(sp.get("limit") || "100", 10) || 100, 500));
  const offset = Math.max(0, parseInt(sp.get("offset") || "0", 10) || 0);

  const data = await loadAllRecentEvents({
    ...(q && { q }),
    ...(action && { actions: [action] }),
    failuresOnly,
    limit,
    offset,
  });
  return jsonOk({ data, count: data.length });
}
