import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchAuthApi } from "@/lib/auth/api";

export async function GET(request: Request) {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const source = new URL(request.url).searchParams;
  const params = new URLSearchParams();
  for (const key of ["user_id", "event_type", "client_id", "limit", "offset"]) {
    const value = source.get(key);
    if (value) params.set(key, value);
  }
  if (!params.has("limit")) params.set("limit", "50");
  if (!params.has("offset")) params.set("offset", "0");

  const result = await fetchAuthApi<Record<string, unknown>>(
    "/v1/admin/audit?" + params.toString(),
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}
