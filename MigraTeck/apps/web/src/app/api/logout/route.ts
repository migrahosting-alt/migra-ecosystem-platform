import { buildLogoutRedirect, clearAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";

export async function POST() {
  ensureAuthClientInitialized();

  await clearAppSession();

  return NextResponse.json({
    loggedOut: true,
    logoutUrl: buildLogoutRedirect(),
  });
}
