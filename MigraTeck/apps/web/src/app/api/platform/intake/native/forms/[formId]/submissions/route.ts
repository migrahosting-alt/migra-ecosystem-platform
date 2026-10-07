import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchPlatformAuthorityApi } from "@/lib/auth/api";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ formId: string }> },
) {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.permissions.includes("platform.read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { formId } = await params;
  const source = new URL(request.url).searchParams;
  const query = new URLSearchParams();
  const status = source.get("status");
  const limit = source.get("limit");
  if (status) query.set("status", status);
  if (limit) query.set("limit", limit);

  const path =
    "/intake/native/forms/" +
    encodeURIComponent(formId) +
    "/submissions" +
    (query.size ? "?" + query.toString() : "");
  const result = await fetchPlatformAuthorityApi<Record<string, unknown>>(path);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}
