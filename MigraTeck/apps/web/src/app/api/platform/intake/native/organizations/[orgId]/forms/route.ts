import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchPlatformAuthorityApi } from "@/lib/auth/api";

async function context() {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  if (!session.permissions.includes("platform.read")) {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as const;
  }
  return {} as const;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const ctx = await context();
  if ("response" in ctx) return ctx.response;
  const { orgId } = await params;
  const result = await fetchPlatformAuthorityApi<Record<string, unknown>>(
    "/intake/native/organizations/" + encodeURIComponent(orgId) + "/forms",
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const ctx = await context();
  if ("response" in ctx) return ctx.response;
  const { orgId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = await fetchPlatformAuthorityApi<Record<string, unknown>>(
    "/intake/native/organizations/" + encodeURIComponent(orgId) + "/forms",
    { method: "POST", body: JSON.stringify(body) },
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data, { status: 201 });
}
