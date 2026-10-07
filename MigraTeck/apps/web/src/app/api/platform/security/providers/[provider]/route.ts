import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchAuthApi } from "@/lib/auth/api";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { provider } = await params;
  const slug = provider.trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,32}$/.test(slug)) {
    return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
  }

  const result = await fetchAuthApi<{ unlinked: boolean }>(
    "/v1/social/" + encodeURIComponent(slug) + "/link",
    { method: "DELETE" },
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.data);
}
