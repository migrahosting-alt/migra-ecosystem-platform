import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchPlatformApi } from "@/lib/auth/api";
import { resolveDeveloperOrganization } from "@/lib/platform/developer-org";

export async function GET(request: Request) {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.permissions.includes("platform.read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const organization = await resolveDeveloperOrganization(session);
  if (!organization) return NextResponse.json({ error: "No organization context" }, { status: 409 });

  const input = new URL(request.url).searchParams;
  const params = new URLSearchParams();
  const endpointId = input.get("endpointId");
  const limit = input.get("limit");
  if (endpointId) params.set("endpointId", endpointId);
  if (limit) params.set("limit", limit);

  const path = "/developer/webhooks/deliveries" + (params.size ? "?" + params.toString() : "");
  const result = await fetchPlatformApi<Record<string, unknown>>(path, organization.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}
