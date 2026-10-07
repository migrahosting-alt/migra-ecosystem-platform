import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchPlatformAuthorityApi } from "@/lib/auth/api";

async function proxy(
  request: Request,
  params: Promise<{ path: string[] }>,
  method: "GET" | "POST" | "PATCH",
) {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.permissions.includes("platform.read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { path } = await params;
  const safePath = path.map((segment) => encodeURIComponent(segment)).join("/");
  const sourceUrl = new URL(request.url);
  const query = sourceUrl.search ? sourceUrl.search : "";

  let body: string | undefined;
  if (method !== "GET") {
    const text = await request.text();
    body = text || "{}";
  }

  const result = await fetchPlatformAuthorityApi<Record<string, unknown>>(
    "/compliance/" + safePath + query,
    {
      method,
      ...(body !== undefined ? { body } : {}),
    },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.data);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  return proxy(request, params, "GET");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  return proxy(request, params, "POST");
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  return proxy(request, params, "PATCH");
}
