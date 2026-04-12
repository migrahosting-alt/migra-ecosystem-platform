import { NextResponse, type NextRequest } from "next/server";
import { getSecurityHeaders } from "@migrateck/lib";

function generateNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

export function middleware(request: NextRequest) {
  const nonce = generateNonce();
  const requestHeaders = new Headers(request.headers);
  const isLocalHttpAudit =
    request.nextUrl.protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(request.nextUrl.hostname);
  const securityHeaders = getSecurityHeaders({
    nonce,
    isDevelopment: process.env.NODE_ENV !== "production",
    upgradeInsecureRequests: !isLocalHttpAudit,
  });

  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(
    "Content-Security-Policy",
    securityHeaders["Content-Security-Policy"],
  );

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  for (const [key, value] of Object.entries(securityHeaders)) {
    response.headers.set(key, value);
  }

  response.headers.set("x-nonce", nonce);

  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
