import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import {
  buildSocialOauthAuthorizeUrl,
  createCodeVerifier,
  createSocialOauthNonce,
  getSocialOauthCookieName,
  getSocialOauthProvider,
  type SocialOauthPlatform,
  type SocialOauthSessionState,
} from "@/lib/migramarket-social-connectors";
import { requireMigraMarketManageContext } from "@/lib/migramarket-social-api";
import { encryptSocialJson } from "@/lib/migramarket-social-secrets";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  connectionId: z.string().cuid().nullable().optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const access = await requireMigraMarketManageContext(request, "/api/migramarket/social/connect/[platform]/start");
  if (!access.ok) return access.response;

  const { platform: rawPlatform } = await params;
  const platform = rawPlatform.trim().toLowerCase() as SocialOauthPlatform;
  const provider = getSocialOauthProvider(platform);
  if (!provider) {
    return NextResponse.json({ error: "OAuth connect is not supported for this platform yet." }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const connectionId: string | null = parsed.data.connectionId || null;
  if (connectionId) {
    const existing = await prisma.migraMarketSocialConnection.findFirst({
      where: {
        id: connectionId,
        orgId: access.context.activeOrg.orgId,
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Connection not found." }, { status: 404 });
    }
    if (existing.platform !== platform) {
      return NextResponse.json({ error: "Platform mismatch for selected connection." }, { status: 400 });
    }
  }

  const nonce = createSocialOauthNonce();
  const codeVerifier = provider.usesPkce ? createCodeVerifier() : null;
  const state: SocialOauthSessionState = {
    nonce,
    platform,
    orgId: access.context.activeOrg.orgId,
    actorUserId: access.context.session.user.id,
    connectionId,
    codeVerifier,
    createdAt: new Date().toISOString(),
  };

  let authorizeUrl: string;
  try {
    authorizeUrl = buildSocialOauthAuthorizeUrl(platform, state);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "OAuth provider is not configured." },
      { status: 400 },
    );
  }

  await writeAuditLog({
    actorId: access.context.session.user.id,
    actorRole: access.context.activeOrg.role,
    orgId: access.context.activeOrg.orgId,
    action: "MIGRAMARKET_SOCIAL_OAUTH_STARTED",
    resourceType: "migramarket_social_connection",
    resourceId: connectionId || platform,
    ip: access.context.ip,
    userAgent: access.context.userAgent,
    metadata: {
      platform,
      connectionId,
    },
  });

  const response = NextResponse.json({ authorizeUrl });
  response.cookies.set({
    name: getSocialOauthCookieName(platform),
    value: encryptSocialJson(state),
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: `/api/migramarket/social/connect/${platform}`,
    maxAge: 60 * 10,
  });
  return response;
}
