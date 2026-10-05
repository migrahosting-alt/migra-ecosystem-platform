import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchAuthApi } from "@/lib/auth/api";
import { resolveDeveloperOrganization } from "@/lib/platform/developer-org";

type OAuthClientRecord = {
  client_id: string;
  owner_org_id: string | null;
  token_auth_method: string;
};

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ clientId: string }> },
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

  const { clientId } = await params;
  const existing = await fetchAuthApi<{ client: OAuthClientRecord }>(
    "/v1/clients/" + encodeURIComponent(clientId),
  );
  if (!existing.ok) {
    return NextResponse.json({ error: existing.error }, { status: existing.status });
  }
  if (existing.data.client.owner_org_id !== organization.id) {
    return NextResponse.json(
      { error: "OAuth application not found in this organization." },
      { status: 404 },
    );
  }
  if (existing.data.client.token_auth_method === "none") {
    return NextResponse.json(
      { error: "Public OAuth applications do not have a client secret to rotate." },
      { status: 409 },
    );
  }

  const result = await fetchAuthApi<Record<string, unknown>>(
    "/v1/clients/" + encodeURIComponent(clientId) + "/rotate-secret",
    { method: "POST", body: JSON.stringify({}) },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.data);
}
