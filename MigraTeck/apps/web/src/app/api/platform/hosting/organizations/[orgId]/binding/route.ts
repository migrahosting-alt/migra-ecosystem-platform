import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchPlatformAuthorityApi } from "@/lib/auth/api";

async function authorize() {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    } as const;
  }
  if (!session.permissions.includes("platform.read")) {
    return {
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    } as const;
  }
  return { session } as const;
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const auth = await authorize();
  if ("response" in auth) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { orgId } = await params;
  const result = await fetchPlatformAuthorityApi<Record<string, unknown>>(
    "/hosting/organizations/" + encodeURIComponent(orgId) + "/binding",
    { method: "PUT", body: JSON.stringify(body) },
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.data);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const auth = await authorize();
  if ("response" in auth) return auth.response;

  const { orgId } = await params;
  const result = await fetchPlatformAuthorityApi<Record<string, unknown>>(
    "/hosting/organizations/" + encodeURIComponent(orgId) + "/binding",
    { method: "DELETE" },
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.data);
}
