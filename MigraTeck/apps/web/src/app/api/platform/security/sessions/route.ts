import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchAuthApi } from "@/lib/auth/api";

/**
 * GET /api/platform/security/sessions — list active sessions
 */
export async function GET() {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await fetchAuthApi<{
    sessions: Array<{
      id: string;
      session_type: string;
      client_id: string | null;
      created_at: string;
      expires_at: string;
      last_seen_at: string | null;
      ip_address: string | null;
      user_agent: string | null;
      device_name: string | null;
      current: boolean;
    }>;
  }>("/v1/sessions");

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.data);
}
