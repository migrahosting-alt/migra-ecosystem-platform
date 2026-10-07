import { clearAppSession, getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchAuthApi } from "@/lib/auth/api";

const bodySchema = z.object({
  new_password: z.string().min(10).max(128),
  current_password: z.string().min(1).max(128).optional(),
  code: z.string().min(4).max(64).optional(),
});

type PasswordResponse = {
  success: boolean;
  created: boolean;
  message: string;
  reauthenticate: {
    required: boolean;
    url: string;
    product_client_id: string | null;
  };
};

export async function POST(request: Request) {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { error: "Use a password between 10 and 128 characters." },
      { status: 400 },
    );
  }

  const result = await fetchAuthApi<PasswordResponse>("/v1/me/password", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  await clearAppSession();
  return NextResponse.json(result.data);
}
