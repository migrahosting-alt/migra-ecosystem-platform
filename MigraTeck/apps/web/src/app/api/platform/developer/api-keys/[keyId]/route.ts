import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchPlatformApi } from "@/lib/auth/api";
import { resolveDeveloperOrganization } from "@/lib/platform/developer-org";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ keyId: string }> },
) {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.permissions.includes("platform.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const organization = await resolveDeveloperOrganization(session);
  if (!organization) {
    return NextResponse.json({ error: "No organization context" }, { status: 409 });
  }

  const { keyId } = await params;
  const result = await fetchPlatformApi<Record<string, unknown>>(
    "/developer/api-keys/" + encodeURIComponent(keyId),
    organization.id,
    { method: "DELETE" },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.data);
}
