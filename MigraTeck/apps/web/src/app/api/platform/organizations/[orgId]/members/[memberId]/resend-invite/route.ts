import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchAuthApi } from "@/lib/auth/api";

type RouteContext = {
  params: Promise<{ orgId: string; memberId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) {
    return NextResponse.json(
      { error: "Session unavailable. Refresh sign-in and try again." },
      { status: 401 },
    );
  }

  const { orgId, memberId } = await context.params;
  const result = await fetchAuthApi<{ resent: boolean; member_id: string }>(
    `/v1/organizations/${encodeURIComponent(orgId)}/members/${encodeURIComponent(memberId)}/resend-invite`,
    { method: "POST" },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.data);
}
