import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchAuthApi } from "@/lib/auth/api";

type Provider = { id: string; label: string };
type Link = {
  provider: string;
  email: string | null;
  display_name: string | null;
  linked_at: string;
  last_used_at: string | null;
};

export async function GET() {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [available, linked] = await Promise.all([
    fetchAuthApi<{ providers: Provider[] }>("/v1/social/providers"),
    fetchAuthApi<{ links: Link[] }>("/v1/social/links"),
  ]);

  if (!available.ok) {
    return NextResponse.json({ error: available.error }, { status: available.status });
  }
  if (!linked.ok) {
    return NextResponse.json({ error: linked.error }, { status: linked.status });
  }

  return NextResponse.json({
    providers: available.data.providers,
    links: linked.data.links,
  });
}
