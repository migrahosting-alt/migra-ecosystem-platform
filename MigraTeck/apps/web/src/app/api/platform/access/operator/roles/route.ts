import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchAuthApi } from "@/lib/auth/api";

const grantBody = z.object({
  user_id: z.string().uuid(),
  role: z.enum(["support", "operator", "owner"]),
  note: z.string().trim().min(1).max(300).optional(),
});

const revokeBody = z.object({
  user_id: z.string().uuid(),
  role: z.enum(["support", "operator", "owner"]),
});

async function context() {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  }
  if (!session.permissions.includes("platform.read")) {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as const;
  }
  return {} as const;
}

export async function POST(request: Request) {
  const ctx = await context();
  if ("response" in ctx) return ctx.response;

  let body: z.infer<typeof grantBody>;
  try {
    body = grantBody.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Choose a valid MigraAuth user and platform role." }, { status: 400 });
  }

  const result = await fetchAuthApi<Record<string, unknown>>("/v1/admin/roles", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!result.ok) {
    return NextResponse.json(
      {
        error:
          result.status === 403
            ? "Platform OWNER authority is required to grant operator roles."
            : result.error,
      },
      { status: result.status },
    );
  }
  return NextResponse.json(result.data);
}

export async function DELETE(request: Request) {
  const ctx = await context();
  if ("response" in ctx) return ctx.response;

  let body: z.infer<typeof revokeBody>;
  try {
    body = revokeBody.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Choose a valid role grant to revoke." }, { status: 400 });
  }

  const result = await fetchAuthApi<Record<string, unknown>>("/v1/admin/roles", {
    method: "DELETE",
    body: JSON.stringify(body),
  });
  if (!result.ok) {
    return NextResponse.json(
      {
        error:
          result.status === 403
            ? "Platform OWNER authority is required to revoke operator roles."
            : result.error,
      },
      { status: result.status },
    );
  }
  return NextResponse.json(result.data);
}
