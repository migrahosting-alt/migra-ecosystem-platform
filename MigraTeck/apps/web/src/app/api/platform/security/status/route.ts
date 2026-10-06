import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchAuthApi } from "@/lib/auth/api";

type SecurityPosture = {
  product_client_id: string | null;
  mfa_enabled: boolean;
  recovery_codes_stale: boolean;
  has_password: boolean;
  password_updated_at: string | null;
  email_verified: boolean;
  linked_providers: string[];
  sign_in_methods: number;
  can_unlink_a_provider: boolean;
};

/**
 * GET /api/platform/security/status
 *
 * Read-only account security posture from MigraAuth. No credential material
 * crosses this boundary: no password hashes, TOTP secret, or recovery codes.
 */
export async function GET() {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await fetchAuthApi<SecurityPosture>("/v1/me/security");
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.data);
}
