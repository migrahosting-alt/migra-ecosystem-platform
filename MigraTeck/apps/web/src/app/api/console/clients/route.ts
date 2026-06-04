import { NextRequest } from "next/server";
import { requireSession, jsonOk, jsonError } from "../../../console/lib/api-helpers";
import { loadAllClients } from "../../../console/lib/modules";

export const dynamic = "force-dynamic";

/**
 * GET /api/console/clients?q=…&status=…&limit=…
 * Returns the same list the UI shows, filtered.
 */
export async function GET(req: NextRequest) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const q = sp.get("q") || undefined;
  const status = sp.get("status") || undefined;
  const limitRaw = sp.get("limit");
  const limit = limitRaw ? Math.max(1, Math.min(parseInt(limitRaw, 10) || 100, 1000)) : 200;

  try {
    const rows = await loadAllClients({
      ...(q && { q }),
      ...(status && { status }),
      limit,
    });
    return jsonOk({ data: rows, count: rows.length });
  } catch (err) {
    return jsonError(500, err instanceof Error ? err.message : "load_failed");
  }
}
