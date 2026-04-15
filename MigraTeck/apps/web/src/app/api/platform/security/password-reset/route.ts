import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchAuthApi } from "@/lib/auth/api";

/**
 * POST /api/platform/security/password-reset — send password reset email
 */
export async function POST() {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await fetchAuthApi<{ message: string }>(
    "/v1/forgot-password",
    {
      method: "POST",
      body: JSON.stringify({ email: session.email }),
    },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ message: "Password reset email sent." });
}
