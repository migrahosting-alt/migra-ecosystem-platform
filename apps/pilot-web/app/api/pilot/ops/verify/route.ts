// POST /api/pilot/ops/verify — Phase 10.6. READ-ONLY post-action verification.
// Dispatches to the verify provider (url/service/deploy/plan). No mutation, allowlisted URLs only.

import { verifyDeploy, verifyPlan, verifyService, verifyUrl } from "../../../../../lib/pilot/ops-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let b: Record<string, unknown> = {};
  try {
    b = await req.json();
  } catch {
    // validated below
  }
  const type = String(b.verificationType ?? "");
  const target = typeof b.target === "string" ? b.target : "";
  const healthUrl = typeof b.healthUrl === "string" && b.healthUrl ? b.healthUrl : undefined;
  const expectedText = typeof b.expectedText === "string" && b.expectedText ? b.expectedText : undefined;
  const expectedBuildId = typeof b.expectedBuildId === "string" && b.expectedBuildId ? b.expectedBuildId : undefined;
  const actionType = typeof b.actionType === "string" ? b.actionType : "";

  switch (type) {
    case "url":
      return Response.json(await verifyUrl(healthUrl ?? target));
    case "service":
      return Response.json(await verifyService(target, healthUrl));
    case "deploy":
      return Response.json(await verifyDeploy(target, { healthUrl, expectedText, expectedBuildId }));
    case "plan":
      return Response.json(await verifyPlan(actionType || "generic", target));
    default:
      return Response.json({ error: "verificationType must be url | service | deploy | plan" }, { status: 400 });
  }
}
