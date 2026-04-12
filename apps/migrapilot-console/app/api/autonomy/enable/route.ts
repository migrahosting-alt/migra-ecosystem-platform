import { NextResponse } from "next/server";

import { updateAutonomyState } from "../../../../lib/autonomy/store";
import { buildAutonomyStatusView } from "../../../../lib/autonomy/scheduler";

export async function POST() {
  const state = updateAutonomyState((current) => ({
    ...current,
    config: {
      ...current.config,
      enabled: true
    }
  }));

  return NextResponse.json({
    ok: true,
    data: buildAutonomyStatusView(state)
  });
}
