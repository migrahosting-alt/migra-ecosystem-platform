import { NextResponse } from "next/server";
import { requireComplianceReportPermission } from "@/lib/compliance/report-auth";
import { getRetentionExecutionHistory, listRetentionPolicies } from "@/lib/retention";

export async function GET(request: Request) {
  const auth = await requireComplianceReportPermission("compliance:read");
  if (!auth.ok) {
    return auth.response;
  }

  const { searchParams } = new URL(request.url);
  const policyId = searchParams.get("policyId");
  const policies = await listRetentionPolicies(auth.ctx.orgId);

  if (policyId) {
    const policy = policies.find((candidate) => candidate.id === policyId);
    if (!policy) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const executionHistory = await getRetentionExecutionHistory(policyId);
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      policy,
      executionHistory,
    });
  }

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    summary: {
      total: policies.length,
      active: policies.filter((policy) => policy.isActive).length,
      byEntityType: policies.reduce<Record<string, number>>((counts, policy) => {
        counts[policy.entityType] = (counts[policy.entityType] || 0) + 1;
        return counts;
      }, {}),
    },
    policies,
  });
}