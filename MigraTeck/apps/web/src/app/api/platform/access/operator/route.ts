import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchAuthApi } from "@/lib/auth/api";

type AuthorityResponse = {
  user_id: string;
  email: string | null;
  roles: string[];
  permissions: string[];
  via_bootstrap: boolean;
};

type RoleGrant = {
  user_id: string;
  email: string | null;
  role: string;
  granted_at: string;
  granted_by_user_id: string | null;
  note: string | null;
};

type RoleListResponse = {
  grants: RoleGrant[];
  permissions: string[];
};

export async function GET() {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.permissions.includes("platform.read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const authority = await fetchAuthApi<AuthorityResponse>("/v1/admin/me");
  if (!authority.ok) {
    if (authority.status === 403) {
      return NextResponse.json({
        operator: false,
        canManageRoles: false,
        authority: null,
        grants: [],
        permissionCatalog: [],
      });
    }
    return NextResponse.json({ error: authority.error }, { status: authority.status });
  }

  const canManageRoles = authority.data.permissions.includes("platform.roles.manage");
  if (!canManageRoles) {
    return NextResponse.json({
      operator: true,
      canManageRoles: false,
      authority: authority.data,
      grants: [],
      permissionCatalog: authority.data.permissions,
    });
  }

  const grants = await fetchAuthApi<RoleListResponse>("/v1/admin/roles");
  if (!grants.ok) {
    return NextResponse.json({ error: grants.error }, { status: grants.status });
  }

  return NextResponse.json({
    operator: true,
    canManageRoles: true,
    authority: authority.data,
    grants: grants.data.grants,
    permissionCatalog: grants.data.permissions,
  });
}
