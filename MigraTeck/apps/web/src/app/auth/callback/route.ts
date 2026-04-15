import { handleOAuthCallback } from "@migrateck/auth-client";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { bootstrapPlatformUser } from "@/lib/auth/bootstrap";
import { ensureAuthClientInitialized } from "@/lib/auth/init";

function resolveBaseUrl(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-host");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  if (forwarded) {
    return `${proto}://${forwarded}`;
  }
  return process.env.APP_BASE_URL ?? request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
  ensureAuthClientInitialized();

  const baseUrl = resolveBaseUrl(request);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    return NextResponse.redirect(new URL("/login?error=invalid_callback", baseUrl));
  }

  try {
    await handleOAuthCallback({
      code,
      state,
      bootstrap: bootstrapPlatformUser,
    });

    return NextResponse.redirect(new URL("/dashboard", baseUrl));
  } catch {
    return NextResponse.redirect(new URL("/login?error=auth_failed", baseUrl));
  }
}
