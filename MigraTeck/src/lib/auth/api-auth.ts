import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth/session";

export async function requireApiSession() {
  const session = await getAuthSession();

  if (!session?.user?.id) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true as const, session };
}
