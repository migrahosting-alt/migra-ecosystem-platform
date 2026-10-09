import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchPlatformAuthorityApi } from "@/lib/auth/api";

function socialResultUrl(
  request: Request,
  input: {
    result: "connected" | "attention" | "error";
    platform: string;
    message?: string | null;
  },
) {
  const url = new URL("/platform/social", request.url);
  url.searchParams.set("oauth", input.result);
  url.searchParams.set("platform", input.platform);
  if (input.message) url.searchParams.set("message", input.message.slice(0, 220));
  return url;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ platform: string }> },
) {
  ensureAuthClientInitialized();
  const { platform } = await params;
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const providerError =
    url.searchParams.get("error") ?? url.searchParams.get("error_description");

  const session = await getAppSession();
  if (!session) {
    return NextResponse.redirect(
      socialResultUrl(request, {
        result: "error",
        platform,
        message: "Your operator sign-in expired. Start the connection again.",
      }),
    );
  }
  if (!session.permissions.includes("platform.read")) {
    return NextResponse.redirect(
      socialResultUrl(request, {
        result: "error",
        platform,
        message: "Platform operator access is required.",
      }),
    );
  }
  if (!state) {
    return NextResponse.redirect(
      socialResultUrl(request, {
        result: "error",
        platform,
        message: "OAuth state is missing. Start the connection again.",
      }),
    );
  }

  const result = await fetchPlatformAuthorityApi<{
    status?: "connected" | "attention";
    message?: string;
  }>("/social/connections/oauth/" + encodeURIComponent(platform) + "/complete", {
    method: "POST",
    body: JSON.stringify({
      state,
      ...(code ? { code } : {}),
      ...(providerError ? { providerError } : {}),
    }),
  });

  if (!result.ok) {
    return NextResponse.redirect(
      socialResultUrl(request, {
        result: "error",
        platform,
        message: result.error,
      }),
    );
  }

  return NextResponse.redirect(
    socialResultUrl(request, {
      result: result.data.status === "attention" ? "attention" : "connected",
      platform,
      message: result.data.message ?? null,
    }),
  );
}
