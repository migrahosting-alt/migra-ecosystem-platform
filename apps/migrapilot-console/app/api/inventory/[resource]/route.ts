import { NextResponse } from "next/server";

import { executeToolWithPolicy } from "../../../../lib/server/tool-runtime";
import { sanitize } from "../../../../lib/server/sanitize";

const toolByResource: Record<string, string> = {
  tenants: "inventory.tenants.list",
  pods: "inventory.pods.list",
  domains: "inventory.domains.map",
  services: "inventory.services.topology",
  topology: "inventory.services.topology"
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ resource: string }> }
) {
  const { resource } = await params;
  const toolName = toolByResource[resource];
  if (!toolName) {
    return NextResponse.json({ ok: false, error: { code: "NOT_FOUND", message: "Unknown resource" } }, { status: 404 });
  }

  const url = new URL(request.url);
  const classification = url.searchParams.get("classification") ?? undefined;
  const tenantId = url.searchParams.get("tenantId") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  const environment = (url.searchParams.get("environment") ?? "prod") as
    | "dev"
    | "stage"
    | "staging"
    | "prod"
    | "test";
  const limit = Number(url.searchParams.get("limit") ?? 100);
  const offset = Number(url.searchParams.get("offset") ?? 0);

  const input: Record<string, unknown> = {
    filter: {
      ...(classification ? { classification } : {}),
      ...(tenantId ? { tenantId } : {}),
      ...(status ? { status } : {}),
      ...(resource !== "services" && resource !== "topology" ? { limit, offset } : {})
    }
  };

  const execution = await executeToolWithPolicy({
    toolName,
    input,
    environment,
    runnerType: "server",
    operator: {
      operatorId: "console-operator",
      role: "owner"
    },
    autonomyBudgetId: "default"
  });

  if (!execution.result.ok) {
    return NextResponse.json({ ok: false, error: execution.result.error, overlay: execution.overlay }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    data: {
      resource,
      payload: sanitize(execution.result.data),
      overlay: execution.overlay
    }
  });
}
