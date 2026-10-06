import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchAuthApi } from "@/lib/auth/api";

const reauthenticationBody = z
  .object({
    password: z.string().min(1).max(128).optional(),
    code: z.string().min(6).max(64).optional(),
  })
  .refine((body) => Boolean(body.password ?? body.code), {
    message: "Provide your password, an authenticator code, or a recovery code.",
  });

/**
 * POST /api/platform/security/mfa/recovery-codes
 *
 * Replaces the current recovery-code set after re-authentication. Plaintext
 * codes are returned once by MigraAuth and are never persisted by this proxy.
 */
export async function POST(request: Request) {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof reauthenticationBody>;
  try {
    body = reauthenticationBody.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid re-authentication proof" }, { status: 400 });
  }

  const result = await fetchAuthApi<{
    recovery_codes: string[];
    count: number;
    message: string;
  }>("/v1/mfa/recovery-codes", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.data);
}
