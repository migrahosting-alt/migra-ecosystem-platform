import { NextResponse } from "next/server";

import { getDriftCorrelation } from "../../../../lib/drift/service";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  if (!from || !to) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "from and to snapshot ids are required"
        }
      },
      { status: 400 }
    );
  }

  const correlation = await getDriftCorrelation(from, to);
  if (!correlation) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: "Drift correlation not found"
        }
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ok: true,
    data: {
      correlation
    }
  });
}
