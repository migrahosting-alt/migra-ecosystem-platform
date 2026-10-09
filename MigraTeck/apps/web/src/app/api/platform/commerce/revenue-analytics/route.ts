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

  const input = new URL(request.url).searchParams;
  const query = new URLSearchParams();
  const windowDays = input.get("windowDays");
  if (windowDays) query.set("windowDays", windowDays);

  const suffix = query.toString() ? "?" + query.toString() : "";
  const result = await fetchPlatformAuthorityApi<Record<string, unknown>>(
    "/commerce/revenue-analytics" + suffix,
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }

  return NextResponse.json(result.data);
}
