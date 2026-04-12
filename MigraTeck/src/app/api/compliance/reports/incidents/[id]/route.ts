import { NextResponse } from "next/server";
import { requireComplianceReportPermission } from "@/lib/compliance/report-auth";
import { getIncident } from "@/lib/compliance-runbooks";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireComplianceReportPermission("incidents:read");
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  const incident = await getIncident(id);
  if (incident.orgId && incident.orgId !== auth.ctx.orgId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    incident,
  });
}