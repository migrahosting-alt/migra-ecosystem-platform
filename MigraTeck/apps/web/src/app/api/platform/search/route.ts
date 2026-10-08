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
  const q = input.get("q")?.trim() ?? "";
  const requestedLimit = Number(input.get("limit") ?? "6");
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 10)
    : 6;

  if (q.length < 2 || q.length > 160) {
    return NextResponse.json(
      { error: "Search requires between 2 and 160 characters." },
      { status: 400 },
    );
  }

  const params = new URLSearchParams({
    q,
    limit: String(limit),
  });
  const result = await fetchPlatformAuthorityApi<Record<string, unknown>>(
    "/search?" + params.toString(),
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.data);
}
