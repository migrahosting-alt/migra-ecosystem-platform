import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchAuthApi } from "@/lib/auth/api";

/**
 * POST /api/platform/security/mfa/enroll — start TOTP enrollment
 */
export async function POST() {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await fetchAuthApi<{
    challenge_id: string;
    secret: string;
    otpauth_uri: string;
    recovery_codes: string[];
    message: string;
  }>("/v1/mfa/totp/enroll", { method: "POST" });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.data);
}
