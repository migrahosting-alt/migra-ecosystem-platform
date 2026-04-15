import { buildLoginRedirect } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";

export async function GET() {
  ensureAuthClientInitialized();

  return NextResponse.redirect(await buildLoginRedirect());
}