import { buildLoginRedirect } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";

export async function GET() {
  ensureAuthClientInitialized();

  /*
   * Parent-company login must never silently inherit whichever MigraAuth
   * issuer session a child product last established. Force an explicit login
   * so the person deliberately chooses/authenticates the MigraTeck identity
   * they want to use here.
   */
  const target = new URL(await buildLoginRedirect());
  target.searchParams.set("prompt", "login");

  return NextResponse.redirect(target);
}
