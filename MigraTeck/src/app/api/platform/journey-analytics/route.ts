import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { getJourneyDistribution, getAtRiskOrgs, getAdoptionFunnel } from "@/lib/customer-journey";

export async function GET(_request: NextRequest) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const ctx = await getActiveOrgContext(auth.session.user.id);
  if (!ctx || !can(ctx.role, "platform:config:manage")) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const [distribution, atRisk, funnel] = await Promise.all([
    getJourneyDistribution(),
    getAtRiskOrgs(),
    getAdoptionFunnel(),
  ]);

  return NextResponse.json({ distribution, atRisk, funnel });
}
