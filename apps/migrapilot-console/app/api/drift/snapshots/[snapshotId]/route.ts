import { NextResponse } from "next/server";

import { getDriftSnapshot } from "../../../../../lib/drift/service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ snapshotId: string }> }
) {
  const { snapshotId } = await params;
  const snapshot = await getDriftSnapshot(snapshotId);
  if (!snapshot) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: `Snapshot not found: ${snapshotId}`
        }
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ok: true,
    data: {
      snapshot
    }
  });
}
