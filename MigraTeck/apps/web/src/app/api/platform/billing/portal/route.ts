import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchPlatformApi } from "@/lib/auth/api";

/**
 * POST /api/platform/billing/portal — create a Stripe billing portal session
 */
export async function POST() {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session?.activeOrgId) {
    return NextResponse.json({ error: "No active organization" }, { status: 400 });
  }

  const result = await fetchPlatformApi<{ url: string }>(
    "/billing/portal-session",
    session.activeOrgId,
    { method: "POST" },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.data);
}
