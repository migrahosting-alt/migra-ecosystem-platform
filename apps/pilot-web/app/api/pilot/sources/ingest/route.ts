// POST /api/pilot/sources/ingest — Phase 9.1.
// Ingests one safe local text file (guardrails enforced in knowledge.ingestSource).

import { ingestSource } from "../../../../../lib/pilot/knowledge";

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
    const source = await ingestSource(path);
    return Response.json({ ok: true, source });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "ingest failed" }, { status: 400 });
  }
}
