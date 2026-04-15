import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { getCommercialSnapshot } from "@/lib/platform/commercial";

/**
 * GET /api/platform/billing — fetch billing overview (account, subscriptions, invoices, payment methods, tax, entitlements, usage)
 */
export async function GET() {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session?.activeOrgId) {
    return NextResponse.json({ error: "No active organization" }, { status: 400 });
  }

  return NextResponse.json(await getCommercialSnapshot(session.activeOrgId));
}
