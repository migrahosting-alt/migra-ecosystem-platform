// GET /api/pilot/sources — Phase 9.1. Lists ingested sources + counts.

import { knowledgeStats, listSources } from "../../../../lib/pilot/knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [stats, sources] = await Promise.all([knowledgeStats(), listSources()]);
  return Response.json({ ...stats, sources });
}
