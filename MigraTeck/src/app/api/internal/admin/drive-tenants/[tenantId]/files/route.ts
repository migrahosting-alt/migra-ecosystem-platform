import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listDriveFilesForOps } from "@/lib/drive/drive-ops";
import { isAuthorizedInternalDriveRequest, unauthorizedDriveResponse } from "@/lib/drive/drive-internal-auth";
import { getDriveTenantById } from "@/lib/drive/drive-tenant-lookup";
import { serializeDriveFile } from "@/lib/drive/drive-files";

const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export async function GET(request: NextRequest, context: { params: Promise<{ tenantId: string }> }) {
  if (!isAuthorizedInternalDriveRequest(request)) {
    return unauthorizedDriveResponse();
  }

  const { tenantId } = await context.params;
  const tenant = await getDriveTenantById(tenantId);
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  const { items, nextCursor } = await listDriveFilesForOps(tenantId, "live", parsed.data.limit, parsed.data.cursor);

  return NextResponse.json({
    items: items.map(serializeDriveFile),
    nextCursor: nextCursor ?? null,
  });
}