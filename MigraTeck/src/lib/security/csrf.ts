import { NextRequest, NextResponse } from "next/server";
import { env, securityAllowedHosts, securityAllowedOrigins, shouldEnforceOriginChecks } from "@/lib/env";

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/$/, "").toLowerCase();
}

function normalizeHost(value: string): string {
  return value.trim().toLowerCase();
}

function firstForwardedValue(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return value.split(",")[0]?.trim() || null;
}

function csrfDeniedResponse(): NextResponse {
  return NextResponse.json(
    { error: "CSRF validation failed." },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}

export function requireSameOrigin(request: NextRequest): NextResponse | null {
  if (!shouldEnforceOriginChecks) {
    return null;
  }

  const origin = request.headers.get("origin");
  const host = firstForwardedValue(request.headers.get("x-forwarded-host")) || request.headers.get("host");
  const proto = firstForwardedValue(request.headers.get("x-forwarded-proto")) || request.nextUrl.protocol.replace(":", "");

  if (!origin || !host) {
    return csrfDeniedResponse();
  }

  const expectedOrigin = `${proto}://${host}`;
  const normalizedOrigin = normalizeOrigin(origin);

  if (normalizedOrigin !== normalizeOrigin(expectedOrigin)) {
    return csrfDeniedResponse();
  }

  const allowedOrigins = new Set(securityAllowedOrigins.map(normalizeOrigin));
  const allowedHosts = new Set(securityAllowedHosts.map(normalizeHost));

  if (env.NEXTAUTH_URL) {
    const configuredOrigin = new URL(env.NEXTAUTH_URL);
    allowedOrigins.add(normalizeOrigin(configuredOrigin.origin));
    allowedHosts.add(normalizeHost(configuredOrigin.host));
  }

  if (allowedOrigins.size > 0 && !allowedOrigins.has(normalizedOrigin)) {
    return csrfDeniedResponse();
  }

  if (allowedHosts.size > 0 && !allowedHosts.has(normalizeHost(host))) {
    return csrfDeniedResponse();
  }

  return null;
}
