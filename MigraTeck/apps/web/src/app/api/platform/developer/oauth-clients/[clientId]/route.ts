import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchAuthApi } from "@/lib/auth/api";
import { resolveDeveloperOrganization } from "@/lib/platform/developer-org";

type OAuthClientRecord = {
  id: string;
  client_id: string;
  client_name: string;
  description: string | null;
  client_type: string;
  redirect_uris: string[];
  post_logout_redirect_uris: string[];
  allowed_scopes: string[];
  requires_pkce: boolean;
  token_auth_method: string;
  is_first_party: boolean;
  is_active: boolean;
  owner_user_id: string | null;
  owner_org_id: string | null;
  created_at: string;
  updated_at: string;
};

async function context(requiredPermission: "platform.read" | "platform.manage") {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  }
  if (!session.permissions.includes(requiredPermission)) {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as const;
  }

  const organization = await resolveDeveloperOrganization(session);
  if (!organization) {
    return { response: NextResponse.json({ error: "No organization context" }, { status: 409 }) } as const;
  }

  return { session, organization } as const;
}

async function loadOwnedClient(clientId: string, orgId: string) {
  const result = await fetchAuthApi<{ client: OAuthClientRecord }>(
    "/v1/clients/" + encodeURIComponent(clientId),
  );
  if (!result.ok) return result;
  if (result.data.client.owner_org_id !== orgId) {
    return { ok: false as const, status: 404, error: "OAuth application not found in this organization." };
  }
  return result;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const ctx = await context("platform.read");
  if ("response" in ctx) return ctx.response;

  const { clientId } = await params;
  const result = await loadOwnedClient(clientId, ctx.organization.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.data);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const ctx = await context("platform.manage");
  if ("response" in ctx) return ctx.response;

  const { clientId } = await params;
  const existing = await loadOwnedClient(clientId, ctx.organization.id);
  if (!existing.ok) {
    return NextResponse.json({ error: existing.error }, { status: existing.status });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Ownership and client type/token-auth mode are immutable through this route.
  delete body.owner_org_id;
  delete body.owner_user_id;
  delete body.client_type;
  delete body.token_auth_method;

  const result = await fetchAuthApi<Record<string, unknown>>(
    "/v1/clients/" + encodeURIComponent(clientId),
    { method: "PATCH", body: JSON.stringify(body) },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.data);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const ctx = await context("platform.manage");
  if ("response" in ctx) return ctx.response;

  const { clientId } = await params;
  const existing = await loadOwnedClient(clientId, ctx.organization.id);
  if (!existing.ok) {
    return NextResponse.json({ error: existing.error }, { status: existing.status });
  }

  const result = await fetchAuthApi<Record<string, unknown>>(
    "/v1/clients/" + encodeURIComponent(clientId),
    { method: "DELETE" },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.data);
}
