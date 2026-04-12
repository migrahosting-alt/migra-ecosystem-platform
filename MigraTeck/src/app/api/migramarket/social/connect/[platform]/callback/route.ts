import { OrgRole, Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import {
  exchangeSocialOauthCode,
  fetchSocialOauthProfile,
  getSocialOauthBaseUrl,
  getSocialOauthCookieName,
  getSocialOauthProvider,
  type SocialOauthPlatform,
  type SocialOauthSessionState,
} from "@/lib/migramarket-social-connectors";
import { syncSocialConnectionForOrg } from "@/lib/migramarket-social-publisher";
import { listToJson } from "@/lib/migramarket";
import { decryptSocialJson, encryptSocialSecret } from "@/lib/migramarket-social-secrets";
import { prisma } from "@/lib/prisma";

function redirectWithResult(platform: string, result: "connected" | "error", message?: string) {
  const url = new URL("/app/migramarket", getSocialOauthBaseUrl());
  url.searchParams.set("social", result);
  url.searchParams.set("platform", platform);
  if (message) {
    url.searchParams.set("message", message);
  }
  return url;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform: rawPlatform } = await params;
  const platform = rawPlatform.trim().toLowerCase() as SocialOauthPlatform;
  const provider = getSocialOauthProvider(platform);
  const cookieName = getSocialOauthCookieName(platform);
  const cookie = request.cookies.get(cookieName)?.value;
  const clearCookieResponse = (response: NextResponse) => {
    response.cookies.set({
      name: cookieName,
      value: "",
      httpOnly: true,
      secure: request.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: `/api/migramarket/social/connect/${platform}`,
      maxAge: 0,
    });
    return response;
  };

  if (!provider || !cookie) {
    return clearCookieResponse(
      NextResponse.redirect(redirectWithResult(platform, "error", "Missing OAuth session.")),
    );
  }

  let state: SocialOauthSessionState;
  try {
    state = decryptSocialJson<SocialOauthSessionState>(cookie);
  } catch {
    return clearCookieResponse(
      NextResponse.redirect(redirectWithResult(platform, "error", "OAuth state could not be verified.")),
    );
  }

  if (state.platform !== platform || request.nextUrl.searchParams.get("state") !== state.nonce) {
    return clearCookieResponse(
      NextResponse.redirect(redirectWithResult(platform, "error", "OAuth state mismatch.")),
    );
  }

  const errorDescription =
    request.nextUrl.searchParams.get("error_description") || request.nextUrl.searchParams.get("error");
  if (errorDescription) {
    return clearCookieResponse(
      NextResponse.redirect(redirectWithResult(platform, "error", errorDescription)),
    );
  }

  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return clearCookieResponse(
      NextResponse.redirect(redirectWithResult(platform, "error", "Missing authorization code.")),
    );
  }

  const membership = await prisma.membership.findFirst({
    where: {
      orgId: state.orgId,
      userId: state.actorUserId,
      status: "ACTIVE",
    },
  });

  if (!membership) {
    return clearCookieResponse(
      NextResponse.redirect(redirectWithResult(platform, "error", "Membership not found.")),
    );
  }

  try {
    const tokenSet = await exchangeSocialOauthCode(platform, code, state.codeVerifier);
    const profile = await fetchSocialOauthProfile(platform, tokenSet);

    const connection =
      (state.connectionId
        ? await prisma.migraMarketSocialConnection.findFirst({
            where: {
              id: state.connectionId,
              orgId: state.orgId,
            },
          })
        : await prisma.migraMarketSocialConnection.findFirst({
            where: {
              orgId: state.orgId,
              platform,
              externalAccountId: profile.externalAccountId,
            },
          })) || null;

    const metadata = {
      oauthProvider: provider.label,
      connectionLabel: profile.metadata.displayName || profile.handle,
      ...profile.metadata,
    };

    const savedConnection = connection
      ? await prisma.migraMarketSocialConnection.update({
          where: { id: connection.id },
          data: {
            handle: profile.handle,
            profileUrl: profile.profileUrl,
            profileType: connection.profileType || "business",
            publishMode: connection.publishMode || "api",
            accessModel: "oauth",
            status: "ready",
            externalAccountId: profile.externalAccountId,
            scopes: listToJson(tokenSet.scopes),
            metadata: JSON.parse(JSON.stringify(metadata)),
            credentialCiphertext: encryptSocialSecret(tokenSet.accessToken),
            refreshTokenCiphertext: tokenSet.refreshToken ? encryptSocialSecret(tokenSet.refreshToken) : null,
            tokenExpiresAt: tokenSet.expiresAt,
            lastVerifiedAt: new Date(),
          } as Prisma.MigraMarketSocialConnectionUpdateInput,
        })
      : await prisma.migraMarketSocialConnection.create({
          data: {
            orgId: state.orgId,
            platform,
            handle: profile.handle,
            profileType: "business",
            profileUrl: profile.profileUrl,
            publishMode: "api",
            accessModel: "oauth",
            status: "ready",
            externalAccountId: profile.externalAccountId,
            scopes: listToJson(tokenSet.scopes),
            metadata: JSON.parse(JSON.stringify(metadata)),
            credentialCiphertext: encryptSocialSecret(tokenSet.accessToken),
            refreshTokenCiphertext: tokenSet.refreshToken ? encryptSocialSecret(tokenSet.refreshToken) : null,
            tokenExpiresAt: tokenSet.expiresAt,
            lastVerifiedAt: new Date(),
          } as Prisma.MigraMarketSocialConnectionUncheckedCreateInput,
        });

    await syncSocialConnectionForOrg(state.orgId, savedConnection.id);

    await writeAuditLog({
      actorId: state.actorUserId,
      actorRole: membership.role as OrgRole,
      orgId: state.orgId,
      action: "MIGRAMARKET_SOCIAL_OAUTH_CONNECTED",
      resourceType: "migramarket_social_connection",
      resourceId: savedConnection.id,
      ip: request.headers.get("x-forwarded-for") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
      metadata: {
        platform,
        externalAccountId: profile.externalAccountId,
        handle: profile.handle,
      },
    });

    return clearCookieResponse(
      NextResponse.redirect(redirectWithResult(platform, "connected")),
    );
  } catch (error) {
    await writeAuditLog({
      actorId: state.actorUserId,
      actorRole: membership.role as OrgRole,
      orgId: state.orgId,
      action: "MIGRAMARKET_SOCIAL_OAUTH_FAILED",
      resourceType: "migramarket_social_connection",
      resourceId: state.connectionId || platform,
      ip: request.headers.get("x-forwarded-for") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
      metadata: {
        platform,
        error: error instanceof Error ? error.message : "oauth_failed",
      },
    });

    return clearCookieResponse(
      NextResponse.redirect(
        redirectWithResult(platform, "error", error instanceof Error ? error.message : "OAuth connection failed."),
      ),
    );
  }
}
