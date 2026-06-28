// GET /api/pilot/sources — Phase 9.1. Lists ingested sources + counts.

import { knowledgeStats, listSources, memoryBackendName } from "../../../../lib/pilot/knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [stats, sources, backend] = await Promise.all([knowledgeStats(), listSources(), memoryBackendName()]);
  return Response.json({ ...stats, sources, backend });
}
