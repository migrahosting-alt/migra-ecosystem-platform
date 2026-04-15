import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchAuthApi } from "@/lib/auth/api";

const addMemberBody = z.object({
  email: z.string().email(),
  role: z.string().default("member"),
});

type RouteContext = { params: Promise<{ orgId: string }> };

function normalizeMemberRole(role: string) {
  switch (role.trim().toLowerCase()) {
    case "admin":
      return "admin";
    case "billing":
    case "billing_admin":
    case "billing-admin":
      return "billing_admin";
    case "readonly":
    case "member":
    default:
      return "member";
  }
}

/**
 * GET /api/platform/organizations/[orgId]/members — list org members
 */
export async function GET(_request: Request, context: RouteContext) {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { orgId } = await context.params;

  const result = await fetchAuthApi<{
    members: Array<{
      id: string;
      role: string;
      status: string;
      joined_at: string;
      user: { id: string; email: string; display_name: string | null };
    }>;
  }>(`/v1/organizations/${encodeURIComponent(orgId)}/members`);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.data);
}

/**
 * POST /api/platform/organizations/[orgId]/members — add a member
 */
export async function POST(request: Request, context: RouteContext) {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { orgId } = await context.params;

  let body: z.infer<typeof addMemberBody>;
  try {
    body = addMemberBody.parse(await request.json());
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
  }>(`/v1/organizations/${encodeURIComponent(orgId)}/members`, {
    method: "POST",
    body: JSON.stringify({
      email: body.email,
      role: normalizeMemberRole(body.role),
    }),
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.data, { status: 201 });
}
