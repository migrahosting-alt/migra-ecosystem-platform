import { NextResponse } from "next/server";

import { executeToolWithPolicy } from "../../../../lib/server/tool-runtime";
import { sanitize } from "../../../../lib/server/sanitize";

const toolByResource: Record<string, string> = {
  search: "repo.search",
  read: "repo.readFile",
  files: "repo.listFiles",
  status: "repo.status",
  diff: "repo.diff",
  run: "repo.run"
};

async function execute(resource: string, input: Record<string, unknown>) {
  const toolName = toolByResource[resource];
  if (!toolName) {
    return { response: NextResponse.json({ ok: false, error: { code: "NOT_FOUND", message: "Unknown repo resource" } }, { status: 404 }) };
  }

  const execution = await executeToolWithPolicy({
    toolName,
    input,
    environment: "dev",
    runnerType: "local",
    operator: {
      operatorId: "console-operator",
      role: "owner"
    },
    autonomyBudgetId: "default"
  });

  if (!execution.result.ok) {
    return { response: NextResponse.json({ ok: false, error: execution.result.error, overlay: execution.overlay }, { status: 400 }) };
  }

  return {
    response: NextResponse.json({
      ok: true,
      data: {
        payload: sanitize(execution.result.data),
        overlay: execution.overlay,
        journalEntryId: execution.result.journalEntryId
      }
    })
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ resource: string }> }
) {
  const { resource } = await params;
  const url = new URL(request.url);
  const input: Record<string, unknown> = {};

  if (resource === "search") {
    input.query = url.searchParams.get("query") ?? "";
    input.maxResults = Number(url.searchParams.get("maxResults") ?? 20);
  }
  if (resource === "read") {
    input.path = url.searchParams.get("path") ?? "";
  }
  if (resource === "files") {
    input.root = url.searchParams.get("root") ?? ".";
    input.glob = url.searchParams.get("glob") ?? null;
    input.max = Number(url.searchParams.get("max") ?? 200);
  }
  if (resource === "diff") {
    input.path = url.searchParams.get("path") ?? null;
    input.staged = url.searchParams.get("staged") === "1";
    input.maxBytes = Number(url.searchParams.get("maxBytes") ?? 262144);
  }

  const { response } = await execute(resource, input);
  return response;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ resource: string }> }
) {
  const { resource } = await params;
  const body = (await request.json()) as Record<string, unknown>;
  const { response } = await execute(resource, body);
  return response;
}
