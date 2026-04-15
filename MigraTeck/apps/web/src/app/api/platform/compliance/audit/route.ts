import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchAuthApi } from "@/lib/auth/api";

/**
 * GET /api/platform/compliance/audit — fetch audit log entries from auth-api
 * Supports query params: event_type, limit, offset
 */
export async function GET(request: Request) {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const params = new URLSearchParams();

  const eventType = url.searchParams.get("event_type");
  const limit = url.searchParams.get("limit") ?? "50";
  const offset = url.searchParams.get("offset") ?? "0";

  if (eventType) params.set("event_type", eventType);
  params.set("limit", limit);
  params.set("offset", offset);
  // Scope to the current user
  if (session.authUserId) params.set("user_id", session.authUserId);

  const result = await fetchAuthApi<{
    audit_logs: Array<{
      id: string;
      event_type: string;
      event_data: Record<string, unknown>;
      ip_address: string | null;
      user_agent: string | null;
      created_at: string;
    }>;
    total: number;
    limit: number;
    offset: number;
  }>(`/v1/admin/audit?${params.toString()}`);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.data);
}
