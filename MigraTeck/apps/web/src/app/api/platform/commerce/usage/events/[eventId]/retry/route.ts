import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchPlatformAuthorityApi } from "@/lib/auth/api";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.permissions.includes("platform.read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { eventId } = await params;
  const result = await fetchPlatformAuthorityApi<Record<string, unknown>>(
    "/commerce/usage/events/" + encodeURIComponent(eventId) + "/retry",
    { method: "POST", body: JSON.stringify({}) },
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data, { status: 202 });
}
