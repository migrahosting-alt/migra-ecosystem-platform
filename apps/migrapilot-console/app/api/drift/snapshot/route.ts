import { NextResponse } from "next/server";

import { createDriftSnapshot, parseClassification, parseEnvironment } from "../../../../lib/drift/service";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    environment?: unknown;
    classification?: unknown;
    note?: unknown;
  };

  try {
    const result = await createDriftSnapshot({
      environment: parseEnvironment(body.environment),
      classification: parseClassification(body.classification),
      note: typeof body.note === "string" ? body.note : undefined
    });

    return NextResponse.json({
      ok: true,
      data: {
        snapshotId: result.snapshot.snapshotId,
        previousSnapshotId: result.previousSnapshotId,
        diffSummary: result.diffRecord
          ? {
              ...result.diffRecord.diff.summary,
              likelyCauseSummary: result.diffRecord.diff.correlation?.summary ?? null
            }
          : null,
        likelyCause: result.diffRecord?.diff.correlation?.best ?? null,
        severity: result.diffRecord?.diff.summary.severity ?? null
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "TOOL_RUNTIME_ERROR",
          message: (error as Error).message
        }
      },
      { status: 500 }
    );
  }
}
