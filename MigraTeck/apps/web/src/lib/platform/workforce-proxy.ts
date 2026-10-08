import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchAuthApi } from "@/lib/auth/api";

export async function requireWorkforceWebSession() {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (!session.permissions.includes("platform.read")) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { ok: true as const, session };
}

export async function forwardWorkforce<T = unknown>(
  path: string,
  options: RequestInit = {},
  forbiddenMessage = "MigraTeck Workforce authority is required for this action.",
) {
  const result = await fetchAuthApi<T>(path, options);
  if (!result.ok) {
    return NextResponse.json(
      {
        error:
          result.status === 403
            ? forbiddenMessage
            : result.error,
      },
      { status: result.status },
    );
  }
  return NextResponse.json(result.data);
}
