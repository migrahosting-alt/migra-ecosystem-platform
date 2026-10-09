import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchPlatformAuthorityApi } from "@/lib/auth/api";

export async function GET(request: Request) {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.permissions.includes("platform.read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const source = new URL(request.url).searchParams;
  const allowed = ["kind", "classification", "action", "offset", "limit"];
  const params = new URLSearchParams();
  for (const key of allowed) {
    const value = source.get(key);
    if (value) params.set(key, value);
  }

  const path =
    "/infrastructure/overlay" +
    (params.size > 0 ? "?" + params.toString() : "");
  const result = await fetchPlatformAuthorityApi<Record<string, unknown>>(path);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.data);
}
