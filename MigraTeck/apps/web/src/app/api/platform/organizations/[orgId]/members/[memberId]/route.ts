import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchAuthApi } from "@/lib/auth/api";

const updateRoleBody = z.object({
  role: z.enum(["admin", "billing_admin", "member"]),
});

type RouteContext = { params: Promise<{ orgId: string; memberId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) {
    return NextResponse.json({ error: "Session unavailable. Refresh sign-in and try again." }, { status: 401 });
  }

  const { orgId, memberId } = await context.params;

  let body: z.infer<typeof updateRoleBody>;
  try {
    body = updateRoleBody.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const result = await fetchAuthApi<{
    member: {
      id: string;
      role: string;
      status: string;
      joined_at: string;
      user: { id: string; email: string; display_name: string | null };
    };
  }>(`/v1/organizations/${encodeURIComponent(orgId)}/members/${encodeURIComponent(memberId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.data);
}

export async function DELETE(_request: Request, context: RouteContext) {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) {
    return NextResponse.json({ error: "Session unavailable. Refresh sign-in and try again." }, { status: 401 });
  }

  const { orgId, memberId } = await context.params;
  const result = await fetchAuthApi<{ removed: boolean; memberId: string }>(
    `/v1/organizations/${encodeURIComponent(orgId)}/members/${encodeURIComponent(memberId)}`,
    { method: "DELETE" },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.data);
}