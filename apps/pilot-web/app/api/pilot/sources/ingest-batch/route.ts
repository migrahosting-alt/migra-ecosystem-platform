// POST /api/pilot/sources/ingest-batch — Phase 9.3.
// Directory/glob ingest. dryRun defaults to TRUE (preview); real ingest needs dryRun:false.

import { ingestBatch } from "../../../../../lib/pilot/knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  let body: { path?: unknown; glob?: unknown; dryRun?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // handled below
  }
  const path = typeof body.path === "string" ? body.path : "";
  const glob = typeof body.glob === "string" && body.glob.trim() ? body.glob : undefined;
  const dryRun = body.dryRun === false ? false : true; // default true; only explicit false ingests

  if (!path) return Response.json({ error: "path required" }, { status: 400 });

  try {
    const result = await ingestBatch(path, glob, dryRun);
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "batch ingest failed" }, { status: 400 });
  }
}
