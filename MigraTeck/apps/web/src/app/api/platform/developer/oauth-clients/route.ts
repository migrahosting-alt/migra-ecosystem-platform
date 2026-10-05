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
  owner_organization: { id: string; name: string; slug: string } | null;
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
    return {
      response: NextResponse.json(
        { error: "Select or join an organization before managing OAuth applications." },
        { status: 409 },
      ),
    } as const;
  }

  return { session, organization } as const;
}

export async function GET() {
  const ctx = await context("platform.read");
  if ("response" in ctx) return ctx.response;

  const [clientsResult, discoveryResult] = await Promise.all([
    fetchAuthApi<{ clients: OAuthClientRecord[] }>("/v1/clients"),
    fetchAuthApi<{ scopes_supported?: string[] }>("/.well-known/openid-configuration"),
  ]);

  if (!clientsResult.ok) {
    return NextResponse.json({ error: clientsResult.error }, { status: clientsResult.status });
  }

  const clients = clientsResult.data.clients.filter(
    (client) => client.owner_org_id === ctx.organization.id,
  );

  return NextResponse.json({
    organization: ctx.organization,
    clients,
    supportedScopes: discoveryResult.ok
      ? discoveryResult.data.scopes_supported ?? ["openid", "profile", "email", "offline_access", "orgs:read"]
      : ["openid", "profile", "email", "offline_access", "orgs:read"],
    supportedClientTypes: ["web", "spa", "native"],
    supportedTokenAuthMethods: ["none", "client_secret_basic", "client_secret_post"],
    serviceGrantAvailable: false,
  });
}

export async function POST(request: Request) {
  const ctx = await context("platform.manage");
  if ("response" in ctx) return ctx.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const clientType = String(body.client_type ?? "");
  if (!["web", "spa", "native"].includes(clientType)) {
    return NextResponse.json(
      { error: "Service OAuth clients are not enabled until client_credentials is available." },
      { status: 400 },
    );
  }

  if ((clientType === "spa" || clientType === "native") && body.token_auth_method !== "none") {
    return NextResponse.json(
      { error: "SPA and native applications must use public-client authentication." },
      { status: 400 },
    );
  }

  const result = await fetchAuthApi<Record<string, unknown>>("/v1/clients", {
    method: "POST",
    body: JSON.stringify({
      ...body,
      owner_org_id: ctx.organization.id,
      requires_pkce: true,
    }),
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.data, { status: 201 });
}
