import { NextResponse } from "next/server";

import { executeToolWithPolicy } from "../../../../lib/server/tool-runtime";
import { sanitize } from "../../../../lib/server/sanitize";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const runId = url.searchParams.get("runId") ?? undefined;
  const tool = url.searchParams.get("tool") ?? undefined;
  const environment = (url.searchParams.get("environment") ?? "dev") as
    | "dev"
    | "stage"
    | "staging"
    | "prod"
    | "test";
  const classification = url.searchParams.get("classification") ?? undefined;
  const limit = Number(url.searchParams.get("limit") ?? 100);

  const execution = await executeToolWithPolicy({
    toolName: "journal.list",
    input: {
      filter: {
        ...(runId ? { runId } : {}),
        ...(tool ? { tool } : {}),
        limit
      }
    },
    environment,
    runnerType: "local",
    operator: {
      operatorId: "console-operator",
      role: "owner"
    },
    autonomyBudgetId: "default"
  });

  if (!execution.result.ok) {
    return NextResponse.json({ ok: false, error: execution.result.error }, { status: 400 });
  }

  const allEntries = (execution.result.data.entries as Array<Record<string, unknown>>) ?? [];
  const filtered = classification
    ? allEntries.filter((entry) => {
        const json = JSON.stringify(entry).toLowerCase();
        return json.includes(`\"classification\":\"${classification.toLowerCase()}\"`);
      })
    : allEntries;

  return NextResponse.json({
    ok: true,
    data: {
      entries: sanitize(filtered),
      total: filtered.length,
      overlay: execution.overlay
    }
  });
}
