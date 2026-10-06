import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchPlatformApi } from "@/lib/auth/api";
import { resolveDeveloperOrganization } from "@/lib/platform/developer-org";

async function context() {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  if (!session.permissions.includes("platform.manage")) {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as const;
  }
  const organization = await resolveDeveloperOrganization(session);
  if (!organization) return { response: NextResponse.json({ error: "No organization context" }, { status: 409 }) } as const;
  return { organization } as const;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ endpointId: string }> },
) {
  const ctx = await context();
  if ("response" in ctx) return ctx.response;
  const { endpointId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = await fetchPlatformApi<Record<string, unknown>>(
    "/developer/webhooks/" + encodeURIComponent(endpointId),
    ctx.organization.id,
    { method: "PATCH", body: JSON.stringify(body) },
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ endpointId: string }> },
) {
  const ctx = await context();
  if ("response" in ctx) return ctx.response;
  const { endpointId } = await params;
  const result = await fetchPlatformApi<Record<string, unknown>>(
    "/developer/webhooks/" + encodeURIComponent(endpointId),
    ctx.organization.id,
    { method: "DELETE" },
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}
