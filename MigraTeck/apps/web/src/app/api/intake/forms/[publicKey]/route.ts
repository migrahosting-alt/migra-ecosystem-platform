import { NextResponse } from "next/server";

function platformBaseUrl() {
  return (
    process.env.MIGRATECK_PLATFORM_API_URL ??
    process.env.MIGRATECK_API_URL ??
    "http://127.0.0.1:4010"
  ).replace(/\/+$/, "");
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Idempotency-Key",
    "Cache-Control": "no-store",
  };
}

function forwardedHeaders(request: Request) {
  const headers = new Headers();
  const realIp = request.headers.get("x-real-ip");
  const userAgent = request.headers.get("user-agent");
  const origin = request.headers.get("origin");
  if (realIp) headers.set("x-forwarded-for", realIp);
  if (userAgent) headers.set("user-agent", userAgent);
  if (origin) headers.set("origin", origin);
  return headers;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ publicKey: string }> },
) {
  const { publicKey } = await params;
  const response = await fetch(
    platformBaseUrl() + "/v1/intake/public/forms/" + encodeURIComponent(publicKey),
    {
      headers: forwardedHeaders(request),
      cache: "no-store",
    },
  );
  const body = await response.json().catch(() => ({
    error: "request_failed",
    message: "Unable to load Intake form.",
  }));
  return NextResponse.json(body, {
    status: response.status,
    headers: corsHeaders(),
  });
}
