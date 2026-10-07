import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { getAccessToken } from "@/lib/auth/api";
import { resolveAuthApiUrl } from "@/lib/platform";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = await getAccessToken();
  if (!token) {
    return NextResponse.json(
      { error: "This control needs a refreshed sign-in before it can load." },
      { status: 401 },
    );
  }

  const { provider } = await params;
  const slug = provider.trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,32}$/.test(slug)) {
    return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
  }

  const appBaseUrl = (
    process.env.APP_BASE_URL ??
    process.env.SITE_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    new URL(request.url).origin
  ).replace(/\/+$/, "");
  const returnTo = appBaseUrl + "/platform/security";
  const target =
    resolveAuthApiUrl() +
    "/v1/social/" +
    encodeURIComponent(slug) +
    "/start?mode=link&return_to=" +
    encodeURIComponent(returnTo);

  const response = await fetch(target, {
    headers: { Authorization: "Bearer " + token },
    redirect: "manual",
    cache: "no-store",
  });

  const location = response.headers.get("location");
  if (response.status >= 300 && response.status < 400 && location) {
    return NextResponse.redirect(new URL(location, target));
  }

  const body = await response.json().catch(() => null);
  return NextResponse.json(
    {
      error:
        body?.error?.message ??
        body?.message ??
        "Unable to start provider linking.",
    },
    { status: response.ok ? 502 : response.status },
  );
}
