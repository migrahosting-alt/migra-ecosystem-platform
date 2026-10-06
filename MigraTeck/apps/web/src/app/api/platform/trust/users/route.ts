import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchAuthApi } from "@/lib/auth/api";

const ALLOWED_STATUS = new Set(["PENDING", "ACTIVE", "LOCKED", "DISABLED"]);

export async function GET(request: Request) {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const source = new URL(request.url).searchParams;
  const params = new URLSearchParams();
  const q = source.get("q")?.trim();
  const status = source.get("status")?.trim();
  const limit = source.get("limit") ?? "40";
  const offset = source.get("offset") ?? "0";

  if (q) params.set("q", q);
  if (status && ALLOWED_STATUS.has(status)) params.set("status", status);
  params.set("limit", limit);
  params.set("offset", offset);

  const result = await fetchAuthApi<Record<string, unknown>>(
    "/v1/admin/users?" + params.toString(),
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}
