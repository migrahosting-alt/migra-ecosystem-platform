import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchAuthApi } from "@/lib/auth/api";

type AuditEntry = {
  id: string;
  actor_user_id: string | null;
  actor_type: string | null;
  target_user_id: string | null;
  client_id: string | null;
  event_type: string;
  event_data: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

type AuditResponse = {
  audit_logs: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
};

function integerParam(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function auditPath(params: URLSearchParams) {
  const query = new URLSearchParams();
  const eventType = params.get("event_type")?.trim();
  const userId = params.get("user_id")?.trim();
  const clientId = params.get("client_id")?.trim();
  const limit = integerParam(params.get("limit"), 50, 1, 200);
  const offset = integerParam(params.get("offset"), 0, 0, 1_000_000);

  if (eventType) query.set("event_type", eventType);
  if (userId) query.set("user_id", userId);
  if (clientId) query.set("client_id", clientId);
  query.set("limit", String(limit));
  query.set("offset", String(offset));

  return {
    path: "/v1/admin/audit?" + query.toString(),
    filters: { eventType, userId, clientId, limit, offset },
  };
}

export async function GET(request: Request) {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.permissions.includes("platform.read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { path, filters } = auditPath(new URL(request.url).searchParams);
  const result = await fetchAuthApi<AuditResponse>(path);

  if (!result.ok) {
    const error =
      result.status === 403
        ? "MigraTeck platform audit authority is required to review global compliance evidence."
        : result.error;
    return NextResponse.json({ error }, { status: result.status });
  }

  const newest = result.data.audit_logs[0]?.created_at ?? null;
  let oldest: string | null = null;

  if (result.data.total > 0) {
    const tail = new URLSearchParams();
    if (filters.eventType) tail.set("event_type", filters.eventType);
    if (filters.userId) tail.set("user_id", filters.userId);
    if (filters.clientId) tail.set("client_id", filters.clientId);
    tail.set("limit", "1");
    tail.set("offset", String(Math.max(0, result.data.total - 1)));

    const tailResult = await fetchAuthApi<AuditResponse>(
      "/v1/admin/audit?" + tail.toString(),
    );
    if (tailResult.ok) {
      oldest = tailResult.data.audit_logs[0]?.created_at ?? null;
    }
  }

  return NextResponse.json({
    ...result.data,
    evidence_window: {
      newest_at: newest,
      oldest_at: oldest,
    },
  });
}
