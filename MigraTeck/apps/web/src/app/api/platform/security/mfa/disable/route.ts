import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchAuthApi } from "@/lib/auth/api";

const disableBody = z
  .object({
    password: z.string().min(1).max(128).optional(),
    code: z.string().min(6).max(64).optional(),
  })
  .refine((body) => Boolean(body.password ?? body.code), {
    message: "Provide your password, an authenticator code, or a recovery code.",
  });

/**
 * POST /api/platform/security/mfa/disable — disable MFA after re-authentication
 */
export async function POST(request: Request) {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof disableBody>;
  try {
    body = disableBody.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const result = await fetchAuthApi<{ success: boolean; message: string }>(
    "/v1/mfa/disable",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.data);
}
