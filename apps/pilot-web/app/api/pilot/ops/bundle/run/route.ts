// POST /api/pilot/ops/bundle/run — Phase 10.9. READ-ONLY health re-check bundle.
// Allowlisted URL checks + grounded docs only; URLs sanitized, response bodies NEVER returned;
// executes no infrastructure command, writes nothing, mutates nothing.

import { buildHealthBundle } from "../../../../../../lib/pilot/ops-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let b: Record<string, unknown> = {};
  try {
    b = await req.json();
  } catch {
    // validated below
  }
  return Response.json(await buildHealthBundle(b as unknown as Parameters<typeof buildHealthBundle>[0]));
}
