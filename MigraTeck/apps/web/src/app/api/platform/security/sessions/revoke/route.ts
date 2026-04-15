import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchAuthApi } from "@/lib/auth/api";

const revokeBody = z.object({
  sessionId: z.string().min(1),
});

/**
 * POST /api/platform/security/sessions/revoke — revoke a session
 */
export async function POST(request: Request) {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof revokeBody>;
  try {
    body = revokeBody.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const result = await fetchAuthApi<{ revoked: boolean }>(
    `/v1/sessions/${encodeURIComponent(body.sessionId)}`,
    { method: "DELETE" },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.data);
}
