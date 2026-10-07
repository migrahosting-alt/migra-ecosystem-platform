import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchAuthApi } from "@/lib/auth/api";

type UserListResponse = {
  users: Array<{
    id: string;
    email: string | null;
    status: string;
    email_verified: boolean;
    display_name: string | null;
    created_at: string;
    last_login_at: string | null;
  }>;
  total: number;
  limit: number;
  offset: number;
};

export async function GET(request: Request) {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.permissions.includes("platform.read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const source = new URL(request.url).searchParams;
  const params = new URLSearchParams({ limit: "20", offset: "0" });
  const q = source.get("q")?.trim();
  if (q) params.set("q", q.slice(0, 160));

  const result = await fetchAuthApi<UserListResponse>(
    "/v1/admin/users?" + params.toString(),
  );
  if (!result.ok) {
    return NextResponse.json(
      {
        error:
          result.status === 403
            ? "Platform operator authority is required to search MigraAuth users."
            : result.error,
      },
      { status: result.status },
    );
  }
  return NextResponse.json(result.data);
}
