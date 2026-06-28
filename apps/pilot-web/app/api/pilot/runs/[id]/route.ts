// GET /api/pilot/runs/:id — Phase 1. Returns a single run (with steps) from the in-memory store.

import { getRun } from "../../../../../lib/pilot/store";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = getRun(id);
  if (!run) {
    return Response.json({ error: "run not found" }, { status: 404 });
  }
  return Response.json({ run });
}
