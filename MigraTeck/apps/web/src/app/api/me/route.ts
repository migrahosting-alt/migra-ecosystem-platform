import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";

export async function GET() {
  ensureAuthClientInitialized();

  const session = await getAppSession();

  if (!session) {
    return NextResponse.json(
      {
        error: {
          code: "unauthorized",
          message: "Unauthorized",
        },
      },
      { status: 401 },
    );
  }

  return NextResponse.json({
    user: {
      id: session.authUserId,
      email: session.email,
      displayName: session.displayName,
    },
    activeOrg: session.activeOrgId
      ? {
          id: session.activeOrgId,
          name: session.activeOrgName ?? "Active organization",
          role: session.activeOrgRole ?? "MEMBER",
        }
      : null,
    permissions: session.permissions,
    productAccount: session.productAccount ?? null,
  });
}
