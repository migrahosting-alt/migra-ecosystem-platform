import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth/org-context";
import { getExport } from "@/lib/data-export";

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ orgId: string; exportId: string }> }
) {
  const result = await requireOrgContext(request, props, { minRole: ["ADMIN", "OWNER"] });
  if (!result.ok) return result.response;

  const { exportId } = await props.params;
  const exp = await getExport(exportId, result.ctx.orgId);

  if (!exp) {
    return NextResponse.json({ error: "Export not found" }, { status: 404 });
  }

  return NextResponse.json({ export: exp });
}
