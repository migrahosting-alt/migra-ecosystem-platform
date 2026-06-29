// POST /api/pilot/ops/preflight — Phase 12.3. READ-ONLY dev service preflight.
// ?mode=preview lists planned checks; default runs read-only checks (incl. optional allowlisted
// health URL). eligibleForFutureExecution is ALWAYS false; nothing executes.

import { previewServicePreflight, runServicePreflight, type PreflightAudience } from "../../../../../lib/pilot/ops-service-preflight";

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
    healthUrl: s("healthUrl"),
    expectedText: s("expectedText"),
    expectedBuildId: s("expectedBuildId"),
    operatorIntent: s("operatorIntent"),
    audience: s("audience") as PreflightAudience | undefined,
  };
  const url = new URL(req.url);
  if (url.searchParams.get("mode") === "preview" || b.mode === "preview") {
    return Response.json(previewServicePreflight(input));
  }
  return Response.json(await runServicePreflight(input, new Date().toISOString()));
}
