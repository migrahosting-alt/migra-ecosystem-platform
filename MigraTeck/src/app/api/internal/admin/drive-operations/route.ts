import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listDriveOperationsForOps } from "@/lib/drive/drive-ops";
import { isAuthorizedInternalDriveRequest, unauthorizedDriveResponse } from "@/lib/drive/drive-internal-auth";
import { serializeDriveTenantOperation } from "@/lib/drive/drive-tenant-serializers";

const querySchema = z.object({
  tenantId: z.string().optional(),
  orgId: z.string().optional(),
  operationType: z.string().optional(),
  status: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export async function GET(request: NextRequest) {
  if (!isAuthorizedInternalDriveRequest(request)) {
    return unauthorizedDriveResponse();
  }

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  const { items, nextCursor } = await listDriveOperationsForOps(parsed.data);
  return NextResponse.json({
    items: items.map(serializeDriveTenantOperation),
    nextCursor: nextCursor ?? null,
  });
}