// POST /api/pilot/sources/search — Phase 9.1. Semantic search over ingested chunks.

import { searchKnowledge } from "../../../../../lib/pilot/knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { query?: unknown; k?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // handled below
  }
  const query = typeof body.query === "string" ? body.query : "";
  const k = typeof body.k === "number" ? body.k : 5;
  if (!query.trim()) return Response.json({ error: "query required" }, { status: 400 });

  try {
    const hits = await searchKnowledge(query, k);
    return Response.json({ hits });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "search failed" }, { status: 500 });
  }
}
