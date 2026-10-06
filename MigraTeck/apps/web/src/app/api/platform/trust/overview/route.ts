import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchAuthApi } from "@/lib/auth/api";

type UsersResult = { total: number };
type AuditResult = { total: number };
type AuthorityResult = {
  user_id: string;
  email: string | null;
  roles: string[];
  permissions: string[];
  via_bootstrap: boolean;
};

export async function GET() {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [authority, active, locked, disabled, pending, audit] = await Promise.all([
    fetchAuthApi<AuthorityResult>("/v1/admin/me"),
    fetchAuthApi<UsersResult>("/v1/admin/users?status=ACTIVE&limit=1&offset=0"),
    fetchAuthApi<UsersResult>("/v1/admin/users?status=LOCKED&limit=1&offset=0"),
    fetchAuthApi<UsersResult>("/v1/admin/users?status=DISABLED&limit=1&offset=0"),
    fetchAuthApi<UsersResult>("/v1/admin/users?status=PENDING&limit=1&offset=0"),
    fetchAuthApi<AuditResult>("/v1/admin/audit?limit=1&offset=0"),
  ]);

  if (!authority.ok) {
    return NextResponse.json({ error: authority.error }, { status: authority.status });
  }
  if (!active.ok) {
    return NextResponse.json({ error: active.error }, { status: active.status });
  }
  if (!locked.ok) {
    return NextResponse.json({ error: locked.error }, { status: locked.status });
  }
  if (!disabled.ok) {
    return NextResponse.json({ error: disabled.error }, { status: disabled.status });
  }
  if (!pending.ok) {
    return NextResponse.json({ error: pending.error }, { status: pending.status });
  }
  if (!audit.ok) {
    return NextResponse.json({ error: audit.error }, { status: audit.status });
  }

  return NextResponse.json({
    authority: authority.data,
    users: {
      active: active.data.total,
      locked: locked.data.total,
      disabled: disabled.data.total,
      pending: pending.data.total,
      total:
        active.data.total +
        locked.data.total +
        disabled.data.total +
        pending.data.total,
    },
    auditTotal: audit.data.total,
  });
}
