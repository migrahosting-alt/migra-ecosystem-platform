import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth/org-context";
import { requestDataExport, processExport, listExports } from "@/lib/data-export";
import { writeAuditLog } from "@/lib/audit";
import { Prisma } from "@prisma/client";

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ orgId: string }> }
) {
  const result = await requireOrgContext(request, props, { minRole: ["ADMIN", "OWNER"] });
  if (!result.ok) return result.response;

  const exports = await listExports(result.ctx.orgId, result.ctx.userId);
  return NextResponse.json({ exports });
}

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ orgId: string }> }
) {
  const result = await requireOrgContext(request, props, { minRole: ["ADMIN", "OWNER"] });
  if (!result.ok) return result.response;

  const body = await request.json();

  const validTypes = ["users", "audit", "usage", "billing", "notifications", "memberships"];
  if (!body.exportType || !validTypes.includes(body.exportType)) {
    return NextResponse.json(
      { error: `exportType must be one of: ${validTypes.join(", ")}` },
      { status: 400 }
    );
  }

  const exp = await requestDataExport({
    orgId: result.ctx.orgId,
    userId: result.ctx.userId,
    exportType: body.exportType,
    format: body.format,
    filters: body.filters as Prisma.InputJsonValue | undefined,
  });

  // Process immediately for small exports (could be async via queue for large ones)
  processExport(exp.id).catch((err) =>
    console.error(`[data-export] failed to process ${exp.id}:`, err)
  );

  await writeAuditLog({
    actorId: result.ctx.userId,
    orgId: result.ctx.orgId,
    action: "DATA_EXPORT_REQUEST",
    entityType: "DataExport",
    entityId: exp.id,
    metadata: { exportType: body.exportType, format: body.format ?? "csv" } as unknown as Prisma.InputJsonValue,
  });

  return NextResponse.json({ export: exp }, { status: 201 });
}
