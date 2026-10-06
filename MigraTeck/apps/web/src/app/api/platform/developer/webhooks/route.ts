import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchPlatformApi } from "@/lib/auth/api";
import { resolveDeveloperOrganization } from "@/lib/platform/developer-org";

async function context(requiredPermission: "platform.read" | "platform.manage") {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  if (!session.permissions.includes(requiredPermission)) {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as const;
  }

  const organization = await resolveDeveloperOrganization(session);
  if (!organization) {
    return {
      response: NextResponse.json(
        { error: "Select or join an organization before managing webhook endpoints." },
        { status: 409 },
      ),
    } as const;
  }
  return { organization } as const;
}

export async function GET() {
  const ctx = await context("platform.read");
  if ("response" in ctx) return ctx.response;
  const result = await fetchPlatformApi<Record<string, unknown>>(
    "/developer/webhooks",
    ctx.organization.id,
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}

export async function POST(request: Request) {
  const ctx = await context("platform.manage");
  if ("response" in ctx) return ctx.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = await fetchPlatformApi<Record<string, unknown>>(
    "/developer/webhooks",
    ctx.organization.id,
    { method: "POST", body: JSON.stringify(body) },
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data, { status: 201 });
}
