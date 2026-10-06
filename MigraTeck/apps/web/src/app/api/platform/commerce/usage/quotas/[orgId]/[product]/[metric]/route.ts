import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchPlatformAuthorityApi } from "@/lib/auth/api";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ orgId: string; product: string; metric: string }> },
) {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.permissions.includes("platform.read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { orgId, product, metric } = await params;
  const result = await fetchPlatformAuthorityApi<Record<string, unknown>>(
    "/commerce/usage/quotas/" +
      encodeURIComponent(orgId) +
      "/" +
      encodeURIComponent(product) +
      "/" +
      encodeURIComponent(metric),
    { method: "PUT", body: JSON.stringify(body) },
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}
