// POST /api/pilot/ops/eligibility — Phase 12.4. READ-ONLY dev action eligibility policy.
// ?mode=preview lists the gates; default evaluates them. eligibleForExecution is ALWAYS false;
// eligibleForFuturePromotion is structural-readiness only. Nothing executes, no approval card.

import { previewEligibility, checkEligibility } from "../../../../../lib/pilot/ops-eligibility-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let b: Record<string, unknown> = {};
  try {
    b = await req.json();
  } catch {
    // validated in the module
  }
  const s = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : undefined);
  const input = {
    targetId: s("targetId") ?? "",
    actionName: s("actionName") ?? "",
    serviceName: s("serviceName"),
    intendedEnvironment: s("intendedEnvironment"),
    requirePostgresBackends: b.requirePostgresBackends === true,
    requireHealthCheck: b.requireHealthCheck === true,
  };
  const url = new URL(req.url);
  if (url.searchParams.get("mode") === "preview" || b.mode === "preview") {
    return Response.json(previewEligibility(input));
  }
  return Response.json(await checkEligibility(input, new Date().toISOString()));
}
