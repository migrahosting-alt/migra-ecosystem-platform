// GET /api/pilot/repo/status — Phase 10.3. Read-only repo HEAD + working tree status,
// via the allowlisted command runner. No mutation, no approval needed.

import { repoStatus } from "../../../../../lib/pilot/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await repoStatus());
}
