import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchPlatformAuthorityApi } from "@/lib/auth/api";
import { resolveDeveloperOrganization } from "@/lib/platform/developer-org";

async function context() {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  }
  if (!session.permissions.includes("platform.read")) {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as const;
  }

  const organization = await resolveDeveloperOrganization(session);
  if (!organization) {
    return {
      response: NextResponse.json(
        { error: "Select or join an organization before managing Hosting linkage." },
        { status: 409 },
      ),
    } as const;
  }

  return { organization } as const;
}

export async function PUT(request: Request) {
  const ctx = await context();
  if ("response" in ctx) return ctx.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = await fetchPlatformAuthorityApi<Record<string, unknown>>(
    "/hosting/organizations/" + encodeURIComponent(ctx.organization.id) + "/binding",
    { method: "PUT", body: JSON.stringify(body) },
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}

export async function DELETE() {
  const ctx = await context();
  if ("response" in ctx) return ctx.response;

  const result = await fetchPlatformAuthorityApi<Record<string, unknown>>(
    "/hosting/organizations/" + encodeURIComponent(ctx.organization.id) + "/binding",
    { method: "DELETE" },
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}
