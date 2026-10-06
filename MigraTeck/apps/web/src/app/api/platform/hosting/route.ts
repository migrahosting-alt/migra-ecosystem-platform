import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchPlatformApi } from "@/lib/auth/api";
import { resolveDeveloperOrganization } from "@/lib/platform/developer-org";

export async function GET() {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.permissions.includes("platform.read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const organization = await resolveDeveloperOrganization(session);
  if (!organization) {
    return NextResponse.json(
      { error: "Select or join an organization before viewing Hosting." },
      { status: 409 },
    );
  }

  const result = await fetchPlatformApi<Record<string, unknown>>(
    "/hosting",
    organization.id,
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}
