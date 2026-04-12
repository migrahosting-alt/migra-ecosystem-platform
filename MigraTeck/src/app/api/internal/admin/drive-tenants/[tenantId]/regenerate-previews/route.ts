import { NextRequest, NextResponse } from "next/server";
import { runDrivePreviewRegeneration } from "@/lib/drive/drive-ops";
import { isAuthorizedInternalDriveRequest, unauthorizedDriveResponse } from "@/lib/drive/drive-internal-auth";
import { getDriveTenantById } from "@/lib/drive/drive-tenant-lookup";
import { serializeDriveTenantOperation } from "@/lib/drive/drive-tenant-serializers";

export async function POST(request: NextRequest, context: { params: Promise<{ tenantId: string }> }) {
  if (!isAuthorizedInternalDriveRequest(request)) {
    return unauthorizedDriveResponse();
  }

  const { tenantId } = await context.params;
  const tenant = await getDriveTenantById(tenantId);
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const result = await runDrivePreviewRegeneration(tenantId);
  return NextResponse.json(
    {
      ok: false,
      error: "preview_pipeline_not_configured",
      operation: serializeDriveTenantOperation(result.operation),
    },
    { status: 501 },
  );
}