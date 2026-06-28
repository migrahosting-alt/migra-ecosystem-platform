// POST /api/pilot/sources/delete — Phase 9.5.
// Removes a source (and its chunks/embeddings) from MEMORY ONLY, by path. Never touches files.

import { deleteSource } from "../../../../../lib/pilot/knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { path?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // handled below
  }
  const path = typeof body.path === "string" ? body.path : "";
  if (!path) return Response.json({ error: "path required" }, { status: 400 });

  try {
    const deleted = await deleteSource(path);
    return Response.json({ ok: true, deleted });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "delete failed" }, { status: 400 });
  }
}
