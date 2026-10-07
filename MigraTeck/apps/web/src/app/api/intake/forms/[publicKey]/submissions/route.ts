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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ publicKey: string }> },
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_json", message: "Invalid submission body." },
      { status: 400, headers: corsHeaders() },
    );
  }

  const { publicKey } = await params;
  const headers = forwardedHeaders(request);
  headers.set("content-type", "application/json");
  const idempotencyKey = request.headers.get("idempotency-key");
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);

  const response = await fetch(
    platformBaseUrl() +
      "/v1/intake/public/forms/" +
      encodeURIComponent(publicKey) +
      "/submissions",
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
    },
  );
  const responseBody = await response.json().catch(() => ({
    error: "request_failed",
    message: "Unable to submit Intake form.",
  }));
  return NextResponse.json(responseBody, {
    status: response.status,
    headers: corsHeaders(),
  });
}
