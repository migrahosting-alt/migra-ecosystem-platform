import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchAuthApi } from "@/lib/auth/api";

const ACTION_PATHS: Record<string, string> = {
  lock: "lock",
  unlock: "unlock",
  disable: "disable",
  "mfa-reset": "mfa/reset",
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, action } = await params;
  const target = ACTION_PATHS[action];
  if (!target) return NextResponse.json({ error: "Unsupported action" }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A reason is required." }, { status: 400 });
  }

  const result = await fetchAuthApi<Record<string, unknown>>(
    "/v1/admin/users/" + encodeURIComponent(id) + "/" + target,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}
