import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchPlatformApi } from "@/lib/auth/api";
import { resolveDeveloperOrganization } from "@/lib/platform/developer-org";

const WINDOWS = new Set(["24h", "7d", "30d"]);

export async function GET(request: Request) {
  ensureAuthClientInitialized();
  const session = await getAppSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.permissions.includes("platform.read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const organization = await resolveDeveloperOrganization(session);
  if (!organization) {
    return NextResponse.json(
      { error: "Select or join an organization before viewing API usage." },
      { status: 409 },
    );
  }

  const requested = new URL(request.url).searchParams.get("window") ?? "24h";
  const window = WINDOWS.has(requested) ? requested : "24h";

  const result = await fetchPlatformApi<Record<string, unknown>>(
    "/developer/usage?window=" + encodeURIComponent(window),
    organization.id,
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.data);
}
