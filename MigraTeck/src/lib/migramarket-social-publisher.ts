import { execFile, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Prisma, type MigraMarketSocialConnection } from "@prisma/client";
import sharp from "sharp";
import { env } from "@/lib/env";
import { validateSocialJobForOrg } from "@/lib/migramarket-campaign-governance";
import { assessSocialConnectionHealth } from "@/lib/migramarket-social-health";
import { platformSupportsLinkPreview } from "@/lib/migramarket-social-link-preview";
import { normalizeStringList } from "@/lib/migramarket";
import { decryptSocialSecret, encryptSocialJson, encryptSocialSecret } from "@/lib/migramarket-social-secrets";
import { prisma } from "@/lib/prisma";

const execFileAsync = promisify(execFile);
const META_GRAPH_BASE = "https://graph.facebook.com/v24.0";
const X_API_BASE = "https://api.x.com";

type SocialConnectionRecord = Pick<
  MigraMarketSocialConnection,
  | "id"
  | "orgId"
  | "platform"
  | "handle"
  | "profileType"
  | "profileUrl"
  | "publishMode"
  | "accessModel"
  | "status"
  | "externalAccountId"
  | "scopes"
  | "metadata"
  | "credentialCiphertext"
  | "refreshTokenCiphertext"
  | "tokenExpiresAt"
  | "lastVerifiedAt"
>;

type ConnectionCredentialBundle = {
  accessToken: string;
  publishAccessToken?: string | null;
};

type PublishResult = {
  platformPostId: string;
  externalPostUrl: string | null;
  publishedVia: string;
};

type SyncResult = {
  connection: MigraMarketSocialConnection;
  credentialBundle: ConnectionCredentialBundle;
  refreshedToken?: boolean;
  profileSynced?: boolean;
};

function stringifyJson(input: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue;
}

function parseConnectionMetadata(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  return { ...(metadata as Record<string, unknown>) };
}

function parseScopes(value: unknown): string[] {
  return normalizeStringList(value);
}

function parseAssetUrls(value: unknown): string[] {
  return normalizeStringList(value);
}

function toOptionalDate(seconds: unknown): Date | null {
  const raw =
    typeof seconds === "number" ? seconds : typeof seconds === "string" ? Number.parseInt(seconds, 10) : Number.NaN;
  if (!Number.isFinite(raw) || raw <= 0) {
    return null;
  }
  return new Date(Date.now() + raw * 1000);
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function parseCredentialBundle(payload: string): ConnectionCredentialBundle {
  const plaintext = decryptSocialSecret(payload);
  try {
    const parsed = JSON.parse(plaintext) as ConnectionCredentialBundle;
    if (parsed && typeof parsed.accessToken === "string" && parsed.accessToken.trim()) {
      return {
        accessToken: parsed.accessToken,
        publishAccessToken: typeof parsed.publishAccessToken === "string" ? parsed.publishAccessToken : null,
      };
    }
  } catch {
    // Fall back to the older single-secret format.
  }
  return { accessToken: plaintext, publishAccessToken: null };
}

function encryptCredentialBundle(bundle: ConnectionCredentialBundle) {
  return encryptSocialJson({
    accessToken: bundle.accessToken,
    publishAccessToken: bundle.publishAccessToken || null,
  });
}

function getRefreshToken(connection: SocialConnectionRecord): string | null {
  if (!connection.refreshTokenCiphertext) {
    return null;
  }
  return decryptSocialSecret(connection.refreshTokenCiphertext);
}

function getCredentialBundle(connection: SocialConnectionRecord): ConnectionCredentialBundle {
  if (!connection.credentialCiphertext) {
    throw new Error("This connection is not authenticated. Reconnect it with OAuth first.");
  }
  return parseCredentialBundle(connection.credentialCiphertext);
}

function shouldRequireReconnect(message: string) {
  return /reconnect|invalid[_\s-]?grant|invalid[_\s-]?token|expired|revoked|unauthoriz|authorization|oauth/i.test(message);
}

async function updateConnectionMetadata(
  connection: SocialConnectionRecord,
  patch: Record<string, unknown>,
  status?: string,
) {
  return prisma.migraMarketSocialConnection.update({
    where: { id: connection.id },
    data: {
      ...(status ? { status } : {}),
      metadata: stringifyJson({
        ...parseConnectionMetadata(connection.metadata),
        ...patch,
      }),
    },
  });
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const raw = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    body = {};
  }
  if (!response.ok) {
    const errorBody = toRecord(body.error);
    const message =
      (typeof errorBody.message === "string" && errorBody.message) ||
      (typeof body.error_description === "string" && body.error_description) ||
      (typeof body.message === "string" && body.message) ||
      raw ||
      `status=${response.status}`;
    throw new Error(message);
  }
  return body;
}

async function getMetaUserPages(accessToken: string) {
  const data = await fetchJson(
    `${META_GRAPH_BASE}/me/accounts?fields=id,name,access_token,category,picture.type(large),tasks&access_token=${encodeURIComponent(accessToken)}`,
  );
  const pages = Array.isArray(data.data) ? data.data : [];
  return pages
    .map((item) => {
      const page = toRecord(item);
      return {
        id: String(page.id || ""),
        name: String(page.name || ""),
        accessToken: String(page.access_token || ""),
        category: String(page.category || "Business"),
        picture: String(toRecord(page.picture).data && toRecord(toRecord(page.picture).data).url || ""),
      };
    })
    .filter((page) => page.id && page.name && page.accessToken);
}

async function getInstagramBusinessAccount(pageId: string, pageAccessToken: string) {
  const data = await fetchJson(
    `${META_GRAPH_BASE}/${encodeURIComponent(pageId)}?fields=instagram_business_account{id,username,followers_count,media_count,profile_picture_url}&access_token=${encodeURIComponent(pageAccessToken)}`,
  );
  const account = toRecord(data.instagram_business_account);
  if (!account.id || !account.username) {
    return null;
  }
  return {
    id: String(account.id),
    username: String(account.username),
    followers: Number(account.followers_count || 0),
    mediaCount: Number(account.media_count || 0),
    picture: typeof account.profile_picture_url === "string" ? account.profile_picture_url : null,
  };
}

function matchesTarget(connection: SocialConnectionRecord, candidates: Array<{ id: string; name: string }>) {
  const metadata = parseConnectionMetadata(connection.metadata);
  const byId = String(connection.externalAccountId || metadata.selectedPageId || "").trim();
  if (byId) {
    const match = candidates.find((item) => item.id === byId);
    if (match) return match;
  }

  const expectedHandle = connection.handle.trim().toLowerCase().replace(/^@/, "");
  if (expectedHandle) {
    const match = candidates.find((item) => item.name.trim().toLowerCase().replace(/^@/, "") === expectedHandle);
    if (match) return match;
  }

  return candidates[0] || null;
}

async function syncFacebookConnection(connection: SocialConnectionRecord, bundle: ConnectionCredentialBundle) {
  const pages = await getMetaUserPages(bundle.accessToken);
  if (!pages.length) {
    throw new Error("No Facebook pages were found for this Meta connection.");
  }
  const selected = matchesTarget(
    connection,
    pages.map((page) => ({ id: page.id, name: page.name })),
  );
  if (!selected) {
    throw new Error("No publishable Facebook page was found.");
  }
  const page = pages.find((item) => item.id === selected.id)!;
  return prisma.migraMarketSocialConnection.update({
    where: { id: connection.id },
    data: {
      handle: page.name,
      profileType: "page",
      profileUrl: `https://www.facebook.com/${page.id}`,
      publishMode: "api",
      accessModel: "oauth",
      status: "ready",
      externalAccountId: page.id,
      metadata: stringifyJson({
        ...parseConnectionMetadata(connection.metadata),
        connectionLabel: page.name,
        displayName: page.name,
        avatarUrl: page.picture || null,
        pageId: page.id,
        pageName: page.name,
        pageCategory: page.category,
        lastSyncError: null,
      }),
      credentialCiphertext: encryptCredentialBundle({
        accessToken: bundle.accessToken,
        publishAccessToken: page.accessToken,
      }),
      lastVerifiedAt: new Date(),
    },
  });
}

async function syncInstagramConnection(connection: SocialConnectionRecord, bundle: ConnectionCredentialBundle) {
  const pages = await getMetaUserPages(bundle.accessToken);
  const candidates: Array<{
    pageId: string;
    pageName: string;
    pageAccessToken: string;
    igId: string;
    username: string;
    followers: number;
    mediaCount: number;
    picture: string | null;
  }> = [];

  for (const page of pages) {
    const account = await getInstagramBusinessAccount(page.id, page.accessToken).catch(() => null);
    if (!account) {
      continue;
    }
    candidates.push({
      pageId: page.id,
      pageName: page.name,
      pageAccessToken: page.accessToken,
      igId: account.id,
      username: account.username,
      followers: account.followers,
      mediaCount: account.mediaCount,
      picture: account.picture,
    });
  }

  if (!candidates.length) {
    throw new Error("No Instagram business account was found for this Meta connection.");
  }

  const metadata = parseConnectionMetadata(connection.metadata);
  const selectedId = String(connection.externalAccountId || metadata.instagramAccountId || "").trim();
  const desiredHandle = connection.handle.trim().toLowerCase().replace(/^@/, "");
  const selected =
    candidates.find((item) => item.igId === selectedId) ||
    candidates.find((item) => item.username.trim().toLowerCase() === desiredHandle) ||
    candidates[0];

  return prisma.migraMarketSocialConnection.update({
    where: { id: connection.id },
    data: {
      handle: `@${selected.username.replace(/^@/, "")}`,
      profileType: "business",
      profileUrl: `https://www.instagram.com/${selected.username.replace(/^@/, "")}`,
      publishMode: "api",
      accessModel: "oauth",
      status: "ready",
      externalAccountId: selected.igId,
      metadata: stringifyJson({
        ...metadata,
        connectionLabel: selected.username,
        displayName: selected.username,
        avatarUrl: selected.picture,
        pageId: selected.pageId,
        pageName: selected.pageName,
        instagramAccountId: selected.igId,
        followers: selected.followers,
        mediaCount: selected.mediaCount,
        lastSyncError: null,
      }),
      credentialCiphertext: encryptCredentialBundle({
        accessToken: bundle.accessToken,
        publishAccessToken: selected.pageAccessToken,
      }),
      lastVerifiedAt: new Date(),
    },
  });
}

async function syncLinkedInConnection(connection: SocialConnectionRecord, bundle: ConnectionCredentialBundle) {
  const data = await fetchJson("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${bundle.accessToken}` },
  });
  const sub = String(data.sub || "");
  if (!sub) {
    throw new Error("LinkedIn did not return a publishable member identity.");
  }
  const email = typeof data.email === "string" ? data.email : null;
  const name =
    (typeof data.name === "string" && data.name) ||
    [data.given_name, data.family_name].filter((item) => typeof item === "string" && item).join(" ") ||
    email ||
    connection.handle;
  const picture = typeof data.picture === "string" ? data.picture : null;
  return prisma.migraMarketSocialConnection.update({
    where: { id: connection.id },
    data: {
      handle: String(name),
      profileType: "profile",
      publishMode: "api",
      accessModel: "oauth",
      status: "ready",
      externalAccountId: sub,
      metadata: stringifyJson({
        ...parseConnectionMetadata(connection.metadata),
        connectionLabel: name,
        displayName: name,
        avatarUrl: picture,
        email,
        authorUrn: `urn:li:person:${sub}`,
        lastSyncError: null,
      }),
      lastVerifiedAt: new Date(),
    },
  });
}

async function syncYouTubeConnection(connection: SocialConnectionRecord, bundle: ConnectionCredentialBundle) {
  const data = await fetchJson("https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true", {
    headers: { Authorization: `Bearer ${bundle.accessToken}` },
  });
  const items = Array.isArray(data.items) ? data.items : [];
  const channels = items
    .map((item) => {
      const channel = toRecord(item);
      const snippet = toRecord(channel.snippet);
      const statistics = toRecord(channel.statistics);
      return {
        id: String(channel.id || ""),
        title: String(snippet.title || ""),
        customUrl: typeof snippet.customUrl === "string" ? snippet.customUrl : null,
        thumbnails: toRecord(snippet.thumbnails),
        subscriberCount: Number(statistics.subscriberCount || 0),
        videoCount: Number(statistics.videoCount || 0),
        viewCount: Number(statistics.viewCount || 0),
      };
    })
    .filter((channel) => channel.id && channel.title);

  if (!channels.length) {
    throw new Error("No YouTube channel was found for this Google account.");
  }

  const selected = matchesTarget(
    connection,
    channels.map((channel) => ({ id: channel.id, name: channel.title })),
  );
  if (!selected) {
    throw new Error("No publishable YouTube channel was found.");
  }
  const channel = channels.find((item) => item.id === selected.id)!;
  const avatarUrl =
    (toRecord(channel.thumbnails.default).url as string | undefined) ||
    (toRecord(channel.thumbnails.medium).url as string | undefined) ||
    (toRecord(channel.thumbnails.high).url as string | undefined) ||
    null;

  return prisma.migraMarketSocialConnection.update({
    where: { id: connection.id },
    data: {
      handle: channel.title,
      profileType: "channel",
      profileUrl: `https://www.youtube.com/channel/${channel.id}`,
      publishMode: "api",
      accessModel: "oauth",
      status: "ready",
      externalAccountId: channel.id,
      metadata: stringifyJson({
        ...parseConnectionMetadata(connection.metadata),
        connectionLabel: channel.title,
        displayName: channel.title,
        avatarUrl,
        channelId: channel.id,
        customUrl: channel.customUrl,
        followers: channel.subscriberCount,
        videoCount: channel.videoCount,
        viewCount: channel.viewCount,
        lastSyncError: null,
      }),
      lastVerifiedAt: new Date(),
    },
  });
}

async function syncXConnection(connection: SocialConnectionRecord, bundle: ConnectionCredentialBundle) {
  const data = await fetchJson("https://api.x.com/2/users/me?user.fields=profile_image_url,username,name,description,public_metrics", {
    headers: { Authorization: `Bearer ${bundle.accessToken}` },
  });
  const user = toRecord(data.data);
  const metrics = toRecord(user.public_metrics);
  const username = String(user.username || "");
  const name = String(user.name || username || connection.handle);
  const id = String(user.id || "");
  if (!id || !username) {
    throw new Error("X did not return a publishable profile.");
  }
  return prisma.migraMarketSocialConnection.update({
    where: { id: connection.id },
    data: {
      handle: `@${username.replace(/^@/, "")}`,
      profileType: "profile",
      profileUrl: `https://x.com/${username.replace(/^@/, "")}`,
      publishMode: "api",
      accessModel: "oauth",
      status: "ready",
      externalAccountId: id,
      metadata: stringifyJson({
        ...parseConnectionMetadata(connection.metadata),
        connectionLabel: name,
        displayName: name,
        avatarUrl: typeof user.profile_image_url === "string" ? user.profile_image_url : null,
        username,
        followers: Number(metrics.followers_count || 0),
        following: Number(metrics.following_count || 0),
        postsCount: Number(metrics.tweet_count || 0),
        lastSyncError: null,
      }),
      lastVerifiedAt: new Date(),
    },
  });
}

async function syncTikTokConnection(connection: SocialConnectionRecord, bundle: ConnectionCredentialBundle) {
  const data = await fetchJson(
    "https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,display_name,avatar_url,username,profile_deep_link,follower_count,following_count,likes_count,video_count",
    {
      headers: { Authorization: `Bearer ${bundle.accessToken}` },
    },
  );
  const user = toRecord(toRecord(data.data).user);
  const openId = String(user.open_id || "");
  const username = String(user.username || "");
  const displayName = String(user.display_name || username || connection.handle);
  if (!openId) {
    throw new Error("TikTok did not return a publishable profile.");
  }
  return prisma.migraMarketSocialConnection.update({
    where: { id: connection.id },
    data: {
      handle: username ? `@${username.replace(/^@/, "")}` : displayName,
      profileType: "profile",
      profileUrl: typeof user.profile_deep_link === "string" ? user.profile_deep_link : connection.profileUrl,
      publishMode: "api",
      accessModel: "oauth",
      status: "ready",
      externalAccountId: openId,
      metadata: stringifyJson({
        ...parseConnectionMetadata(connection.metadata),
        connectionLabel: displayName,
        displayName,
        avatarUrl: typeof user.avatar_url === "string" ? user.avatar_url : null,
        username: username || null,
        followers: Number(user.follower_count || 0),
        following: Number(user.following_count || 0),
        likes: Number(user.likes_count || 0),
        postsCount: Number(user.video_count || 0),
        lastSyncError: null,
      }),
      lastVerifiedAt: new Date(),
    },
  });
}

async function recordConnectionSyncError(connection: SocialConnectionRecord, message: string) {
  return prisma.migraMarketSocialConnection.update({
    where: { id: connection.id },
    data: {
      status: shouldRequireReconnect(message) ? "reconnect_required" : connection.status,
      metadata: stringifyJson({
        ...parseConnectionMetadata(connection.metadata),
        lastSyncError: message,
      }),
      lastVerifiedAt: new Date(),
    },
  });
}

async function syncLoadedSocialConnection(connection: SocialConnectionRecord, bundle: ConnectionCredentialBundle): Promise<SyncResult> {
  try {
    const refreshed =
      connection.platform === "facebook"
        ? await syncFacebookConnection(connection, bundle)
        : connection.platform === "instagram"
          ? await syncInstagramConnection(connection, bundle)
          : connection.platform === "linkedin"
            ? await syncLinkedInConnection(connection, bundle)
            : connection.platform === "youtube"
              ? await syncYouTubeConnection(connection, bundle)
              : connection.platform === "x"
                ? await syncXConnection(connection, bundle)
                : connection.platform === "tiktok"
                  ? await syncTikTokConnection(connection, bundle)
                  : await prisma.migraMarketSocialConnection.update({
                      where: { id: connection.id },
                      data: {
                        lastVerifiedAt: new Date(),
                        metadata: stringifyJson({
                          ...parseConnectionMetadata(connection.metadata),
                          lastSyncError: null,
                        }),
                      },
                    });

    return {
      connection: refreshed,
      credentialBundle: getCredentialBundle(refreshed),
      profileSynced: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "sync_failed";
    const updated = await recordConnectionSyncError(connection, message);
    throw Object.assign(new Error(message), { connection: updated });
  }
}

async function refreshXAccessToken(connection: SocialConnectionRecord) {
  const refreshToken = getRefreshToken(connection);
  if (!refreshToken || !env.MIGRAMARKET_X_CLIENT_ID) {
    throw new Error("X refresh is not available. Reconnect the account.");
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  if (env.MIGRAMARKET_X_CLIENT_SECRET) {
    headers.Authorization = `Basic ${Buffer.from(`${env.MIGRAMARKET_X_CLIENT_ID}:${env.MIGRAMARKET_X_CLIENT_SECRET}`).toString("base64")}`;
  } else {
    body.set("client_id", env.MIGRAMARKET_X_CLIENT_ID);
  }

  const token = await fetchJson(`${X_API_BASE}/2/oauth2/token`, {
    method: "POST",
    headers,
    body,
  });
  const refreshedBundle = {
    ...getCredentialBundle(connection),
    accessToken: String(token.access_token || ""),
  };
  const updated = await prisma.migraMarketSocialConnection.update({
    where: { id: connection.id },
    data: {
      credentialCiphertext: encryptCredentialBundle(refreshedBundle),
      refreshTokenCiphertext:
        typeof token.refresh_token === "string" && token.refresh_token
          ? encryptSocialSecret(token.refresh_token)
          : connection.refreshTokenCiphertext,
      tokenExpiresAt: toOptionalDate(token.expires_in),
      scopes: Array.isArray(token.scope)
        ? stringifyJson(token.scope)
        : connection.scopes ?? Prisma.JsonNull,
      lastVerifiedAt: new Date(),
    },
  });
  return { connection: updated, bundle: refreshedBundle };
}

async function refreshLinkedInToken(connection: SocialConnectionRecord) {
  const refreshToken = getRefreshToken(connection);
  if (!refreshToken || !env.MIGRAMARKET_LINKEDIN_CLIENT_ID || !env.MIGRAMARKET_LINKEDIN_CLIENT_SECRET) {
    throw new Error("LinkedIn refresh is not available. Reconnect the account.");
  }
  const token = await fetchJson("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: env.MIGRAMARKET_LINKEDIN_CLIENT_ID,
      client_secret: env.MIGRAMARKET_LINKEDIN_CLIENT_SECRET,
    }),
  });
  const refreshedBundle = {
    ...getCredentialBundle(connection),
    accessToken: String(token.access_token || ""),
  };
  const updated = await prisma.migraMarketSocialConnection.update({
    where: { id: connection.id },
    data: {
      credentialCiphertext: encryptCredentialBundle(refreshedBundle),
      refreshTokenCiphertext:
        typeof token.refresh_token === "string" && token.refresh_token
          ? encryptSocialSecret(token.refresh_token)
          : connection.refreshTokenCiphertext,
      tokenExpiresAt: toOptionalDate(token.expires_in),
      lastVerifiedAt: new Date(),
    },
  });
  return { connection: updated, bundle: refreshedBundle };
}

async function refreshGoogleToken(connection: SocialConnectionRecord) {
  const refreshToken = getRefreshToken(connection);
  if (!refreshToken || !env.MIGRAMARKET_GOOGLE_CLIENT_ID || !env.MIGRAMARKET_GOOGLE_CLIENT_SECRET) {
    throw new Error("Google refresh is not available. Reconnect the account.");
  }
  const token = await fetchJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.MIGRAMARKET_GOOGLE_CLIENT_ID,
      client_secret: env.MIGRAMARKET_GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const refreshedBundle = {
    ...getCredentialBundle(connection),
    accessToken: String(token.access_token || ""),
  };
  const updated = await prisma.migraMarketSocialConnection.update({
    where: { id: connection.id },
    data: {
      credentialCiphertext: encryptCredentialBundle(refreshedBundle),
      tokenExpiresAt: toOptionalDate(token.expires_in),
      lastVerifiedAt: new Date(),
    },
  });
  return { connection: updated, bundle: refreshedBundle };
}

async function refreshTikTokToken(connection: SocialConnectionRecord) {
  const refreshToken = getRefreshToken(connection);
  if (!refreshToken || !env.MIGRAMARKET_TIKTOK_CLIENT_KEY || !env.MIGRAMARKET_TIKTOK_CLIENT_SECRET) {
    throw new Error("TikTok refresh is not available. Reconnect the account.");
  }
  const token = await fetchJson("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: env.MIGRAMARKET_TIKTOK_CLIENT_KEY,
      client_secret: env.MIGRAMARKET_TIKTOK_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const tokenRoot = toRecord(token.data && typeof token.data === "object" ? token.data : token);
  const refreshedBundle = {
    ...getCredentialBundle(connection),
    accessToken: String(tokenRoot.access_token || ""),
  };
  const updated = await prisma.migraMarketSocialConnection.update({
    where: { id: connection.id },
    data: {
      credentialCiphertext: encryptCredentialBundle(refreshedBundle),
      refreshTokenCiphertext:
        typeof tokenRoot.refresh_token === "string" && tokenRoot.refresh_token
          ? encryptSocialSecret(tokenRoot.refresh_token)
          : connection.refreshTokenCiphertext,
      tokenExpiresAt: toOptionalDate(tokenRoot.expires_in),
      scopes:
        typeof tokenRoot.scope === "string"
          ? stringifyJson(tokenRoot.scope.split(",").map((item) => item.trim()).filter(Boolean))
          : connection.scopes ?? Prisma.JsonNull,
      lastVerifiedAt: new Date(),
    },
  });
  return { connection: updated, bundle: refreshedBundle };
}

async function refreshMetaAccessToken(connection: SocialConnectionRecord) {
  if (!env.MIGRAMARKET_META_CLIENT_ID || !env.MIGRAMARKET_META_CLIENT_SECRET) {
    throw new Error("Meta refresh is not available. Reconnect the account.");
  }

  const currentBundle = getCredentialBundle(connection);
  const token = await fetchJson(
    `${META_GRAPH_BASE}/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(env.MIGRAMARKET_META_CLIENT_ID)}&client_secret=${encodeURIComponent(env.MIGRAMARKET_META_CLIENT_SECRET)}&fb_exchange_token=${encodeURIComponent(currentBundle.accessToken)}`,
  );
  const accessToken = String(token.access_token || "").trim();
  if (!accessToken) {
    throw new Error("Meta refresh did not return an access token.");
  }

  const refreshedBundle = {
    ...currentBundle,
    accessToken,
  };
  const updated = await prisma.migraMarketSocialConnection.update({
    where: { id: connection.id },
    data: {
      credentialCiphertext: encryptCredentialBundle(refreshedBundle),
      tokenExpiresAt: toOptionalDate(token.expires_in),
      lastVerifiedAt: new Date(),
    },
  });
  return { connection: updated, bundle: refreshedBundle };
}

async function refreshConnectionAccessTokenIfNeeded(
  connection: MigraMarketSocialConnection,
  force = false,
): Promise<{ connection: MigraMarketSocialConnection; bundle: ConnectionCredentialBundle; refreshed: boolean }> {
  const health = assessSocialConnectionHealth(connection);
  if (!connection.credentialCiphertext) {
    throw new Error("This connection is not authenticated. Reconnect it with OAuth first.");
  }

  if (!force && health.recommendedAction !== "refresh") {
    return {
      connection,
      bundle: getCredentialBundle(connection),
      refreshed: false,
    };
  }

  try {
    const refreshed =
      connection.platform === "facebook" || connection.platform === "instagram"
        ? await refreshMetaAccessToken(connection)
        : connection.platform === "x"
          ? await refreshXAccessToken(connection)
          : connection.platform === "linkedin"
            ? await refreshLinkedInToken(connection)
            : connection.platform === "youtube"
              ? await refreshGoogleToken(connection)
              : connection.platform === "tiktok"
                ? await refreshTikTokToken(connection)
                : null;

    if (!refreshed) {
      return {
        connection,
        bundle: getCredentialBundle(connection),
        refreshed: false,
      };
    }

    const settled = await updateConnectionMetadata(
      refreshed.connection,
      {
        lastTokenRefreshAt: new Date().toISOString(),
        lastTokenRefreshError: null,
        lastSyncError: null,
      },
      "ready",
    );

    return {
      connection: settled,
      bundle: getCredentialBundle(settled),
      refreshed: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "token_refresh_failed";
    const updated = await updateConnectionMetadata(
      connection,
      {
        lastTokenRefreshError: message,
        lastSyncError: message,
      },
      shouldRequireReconnect(message) ? "reconnect_required" : connection.status,
    );
    throw Object.assign(new Error(message), { connection: updated });
  }
}

export async function ensureSocialConnectionOperationalForOrg(
  orgId: string,
  connectionId: string,
  input?: { forceProfileSync?: boolean; forceRefresh?: boolean },
): Promise<SyncResult> {
  const connection = await prisma.migraMarketSocialConnection.findFirst({
    where: { id: connectionId, orgId },
  });
  if (!connection) {
    throw new Error("Social connection not found.");
  }

  let workingConnection = connection;
  let bundle = getCredentialBundle(workingConnection);
  let refreshedToken = false;
  let profileSynced = false;

  const refreshResult = await refreshConnectionAccessTokenIfNeeded(workingConnection, input?.forceRefresh === true);
  workingConnection = refreshResult.connection;
  bundle = refreshResult.bundle;
  refreshedToken = refreshResult.refreshed;

  const health = assessSocialConnectionHealth(workingConnection);
  const needsProfileSync =
    input?.forceProfileSync === true ||
    refreshedToken ||
    health.recommendedAction === "sync" ||
    Boolean(parseConnectionMetadata(workingConnection.metadata).lastSyncError);

  if (needsProfileSync) {
    const synced = await syncLoadedSocialConnection(workingConnection, bundle);
    workingConnection = synced.connection;
    bundle = synced.credentialBundle;
    profileSynced = true;
  }

  return {
    connection: workingConnection,
    credentialBundle: bundle,
    refreshedToken,
    profileSynced,
  };
}

export async function syncSocialConnectionForOrg(orgId: string, connectionId: string): Promise<SyncResult> {
  return ensureSocialConnectionOperationalForOrg(orgId, connectionId, {
    forceProfileSync: true,
  });
}

function buildXPostText(caption: string, link?: string | null) {
  const text = caption.trim();
  const url = String(link || "").trim();
  if (!url) {
    return text.slice(0, 280);
  }
  const maxCaption = Math.max(0, 280 - url.length - 1);
  return `${text.slice(0, maxCaption)}\n${url}`.trim();
}

function buildLinkedInPostText(caption: string, link?: string | null) {
  const text = caption.trim();
  const url = String(link || "").trim();
  if (!url) {
    return text.slice(0, 3000);
  }
  const maxCaption = Math.max(0, 3000 - url.length - 1);
  return `${text.slice(0, maxCaption)}\n${url}`.trim();
}

function buildTikTokCaption(caption: string, link?: string | null) {
  const text = caption.trim();
  const url = String(link || "").trim();
  if (!url) {
    return text.slice(0, 2200);
  }
  const maxCaption = Math.max(0, 2200 - url.length - 1);
  return `${text.slice(0, maxCaption)}\n${url}`.trim();
}

function buildYouTubeTitle(input: string) {
  const firstLine = input.split(/\r?\n/, 1)[0]?.trim() || "";
  return (firstLine || "MigraTeck Update").slice(0, 100);
}

function buildYouTubeDescription(caption: string, link?: string | null) {
  const url = String(link || "").trim();
  const description = url ? `${caption.trim()}\n\n${url}` : caption.trim();
  return description.slice(0, 5000);
}

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "m4v", "avi", "mpeg", "mpg", "mkv"]);
const VIDEO_STYLE_FORMATS = new Set(["video", "short", "reel"]);

function looksLikeVideoUrl(value: string) {
  const raw = value.trim();
  if (!raw) return false;
  if (raw.startsWith("data:video/")) return true;
  try {
    const parsed = new URL(raw);
    const ext = parsed.pathname.includes(".") ? parsed.pathname.split(".").pop()?.toLowerCase() || "" : "";
    return VIDEO_EXTENSIONS.has(ext);
  } catch {
    const ext = raw.split("?")[0].split(".").pop()?.toLowerCase() || "";
    return VIDEO_EXTENSIONS.has(ext);
  }
}

function pickVideoMediaUrl(mediaUrls: string[], format?: string | null) {
  const explicit = mediaUrls.find((item) => looksLikeVideoUrl(item));
  if (explicit) return explicit;
  const rawFormat = String(format || "").trim().toLowerCase();
  if (VIDEO_STYLE_FORMATS.has(rawFormat) && mediaUrls.length) {
    return mediaUrls[0];
  }
  return null;
}

function pickImageMediaUrls(mediaUrls: string[]) {
  return mediaUrls.filter((item) => !looksLikeVideoUrl(item));
}

function inferVideoMimeTypeFromUrl(url: string) {
  const raw = url.toLowerCase();
  if (raw.includes(".mov")) return "video/quicktime";
  if (raw.includes(".webm")) return "video/webm";
  if (raw.includes(".mkv")) return "video/x-matroska";
  if (raw.includes(".avi")) return "video/x-msvideo";
  return "video/mp4";
}

function inferImageExtension(contentType: string | null) {
  const raw = String(contentType || "").toLowerCase();
  if (raw.includes("svg")) return "svg";
  if (raw.includes("png")) return "png";
  if (raw.includes("webp")) return "webp";
  return "jpg";
}

function inferImageMimeType(contentType: string | null, url?: string) {
  const raw = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (raw.startsWith("image/")) return raw;
  const lowerUrl = String(url || "").toLowerCase();
  if (lowerUrl.includes(".png")) return "image/png";
  if (lowerUrl.includes(".webp")) return "image/webp";
  if (lowerUrl.includes(".bmp")) return "image/bmp";
  if (lowerUrl.includes(".tif") || lowerUrl.includes(".tiff")) return "image/tiff";
  if (lowerUrl.includes(".svg")) return "image/svg+xml";
  return "image/jpeg";
}

function getKnownPublicOrigins() {
  const origins = new Set<string>();
  for (const value of [env.NEXTAUTH_URL, process.env.BASE_URL, "http://localhost:3000"]) {
    if (!value) continue;
    try {
      origins.add(new URL(value).origin);
    } catch {
      // Ignore malformed env entries here and let the network path handle it.
    }
  }
  return origins;
}

async function tryReadLocalPublicAsset(url: string, maxBytes: number) {
  const publicRoot = path.resolve(process.cwd(), "public");
  let pathname = "";

  if (url.startsWith("/")) {
    pathname = url;
  } else {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (!getKnownPublicOrigins().has(parsed.origin)) {
      return null;
    }
    pathname = parsed.pathname;
  }

  const localPath = path.resolve(publicRoot, `.${pathname}`);
  if (!localPath.startsWith(publicRoot + path.sep) && localPath !== publicRoot) {
    return null;
  }

  try {
    const stats = await fs.stat(localPath);
    if (!stats.isFile()) {
      return null;
    }
    if (stats.size > maxBytes) {
      throw new Error(`Image exceeds maximum conversion size (${maxBytes} bytes).`);
    }
    const buffer = await fs.readFile(localPath);
    if (!buffer.length) {
      throw new Error("Image file was empty.");
    }
    return {
      buffer,
      ext: localPath.toLowerCase().includes(".svg") ? "svg" : inferImageExtension(null),
      mimeType: inferImageMimeType(null, localPath),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

let ffmpegAvailable: boolean | null = null;

function hasFfmpeg() {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  const probe = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  ffmpegAvailable = probe.status === 0;
  return ffmpegAvailable;
}

async function downloadRemoteVideo(url: string, maxBytes: number) {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(180000) });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Video download failed status=${response.status} ${body.slice(0, 240)}`);
  }
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > maxBytes) {
    throw new Error(`Video exceeds maximum upload size (${maxBytes} bytes).`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) {
    throw new Error("Video download returned empty content.");
  }
  if (buffer.length > maxBytes) {
    throw new Error(`Video exceeds maximum upload size (${maxBytes} bytes).`);
  }
  const headerType = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  return {
    buffer,
    mimeType: headerType.startsWith("video/") ? headerType : inferVideoMimeTypeFromUrl(url),
  };
}

async function downloadRemoteImage(url: string, maxBytes: number) {
  const localAsset = await tryReadLocalPublicAsset(url, maxBytes);
  if (localAsset) {
    return localAsset;
  }

  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120000) });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Image download failed status=${response.status} ${body.slice(0, 240)}`);
  }
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > maxBytes) {
    throw new Error(`Image exceeds maximum conversion size (${maxBytes} bytes).`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) {
    throw new Error("Image download returned empty content.");
  }
  if (buffer.length > maxBytes) {
    throw new Error(`Image exceeds maximum conversion size (${maxBytes} bytes).`);
  }
  return {
    buffer,
    ext: inferImageExtension(response.headers.get("content-type")),
    mimeType: inferImageMimeType(response.headers.get("content-type"), url),
  };
}

async function convertImageBufferToMp4(imageBuffer: Buffer, imageExt: string) {
  if (!hasFfmpeg()) {
    throw new Error("ffmpeg is required for image-to-video conversion.");
  }
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "migramarket-yt-"));
  const inputPath = path.join(workDir, `input.${imageExt}`);
  const outputPath = path.join(workDir, `${randomUUID()}.mp4`);
  try {
    await fs.writeFile(inputPath, imageBuffer);
    await execFileAsync("ffmpeg", [
      "-y",
      "-loop",
      "1",
      "-i",
      inputPath,
      "-t",
      "8",
      "-vf",
      "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
      "-r",
      "30",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-an",
      outputPath,
    ]);
    return await fs.readFile(outputPath);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

async function publishToFacebook(
  connection: SocialConnectionRecord,
  bundle: ConnectionCredentialBundle,
  caption: string,
  assetUrls: string[],
  link?: string | null,
  preferLinkPreview = false,
): Promise<PublishResult> {
  const pageId = String(connection.externalAccountId || "");
  const pageToken = bundle.publishAccessToken || bundle.accessToken;
  if (!pageId || !pageToken) {
    throw new Error("Facebook page connection is incomplete. Sync the connection and try again.");
  }
  const imageUrl = assetUrls[0];
  const shouldPublishLinkPost = preferLinkPreview && Boolean(link);
  const body =
    shouldPublishLinkPost
      ? { message: caption, link, access_token: pageToken }
      : imageUrl
      ? { url: imageUrl, message: caption, access_token: pageToken }
      : link
        ? { message: caption, link, access_token: pageToken }
        : { message: caption, access_token: pageToken };
  const endpoint = shouldPublishLinkPost ? `${META_GRAPH_BASE}/${pageId}/feed` : imageUrl ? `${META_GRAPH_BASE}/${pageId}/photos` : `${META_GRAPH_BASE}/${pageId}/feed`;
  const result = await fetchJson(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const id = String(result.id || result.post_id || "");
  if (!id) {
    throw new Error("Facebook did not return a post id.");
  }
  return {
    platformPostId: id,
    externalPostUrl: `https://facebook.com/${id}`,
    publishedVia: "meta_graph_api",
  };
}

async function publishToInstagram(connection: SocialConnectionRecord, bundle: ConnectionCredentialBundle, caption: string, assetUrls: string[]) {
  const igUserId = String(connection.externalAccountId || "");
  const pageToken = bundle.publishAccessToken || bundle.accessToken;
  const imageUrl = assetUrls[0];
  if (!igUserId || !pageToken || !imageUrl) {
    throw new Error("Instagram requires a synced business account and at least one image/video URL.");
  }
  const container = await fetchJson(`${META_GRAPH_BASE}/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_url: imageUrl,
      caption,
      access_token: pageToken,
    }),
  });
  const containerId = String(container.id || "");
  if (!containerId) {
    throw new Error("Instagram did not return a media container id.");
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const status = await fetchJson(
      `${META_GRAPH_BASE}/${containerId}?fields=status_code,status,error_message&access_token=${encodeURIComponent(pageToken)}`,
    );
    const statusCode = String(status.status_code || status.status || "").trim().toUpperCase();
    if (statusCode === "FINISHED") {
      break;
    }
    if (statusCode === "ERROR" || statusCode === "EXPIRED") {
      throw new Error(String(status.error_message || `Instagram container ${statusCode.toLowerCase()}`));
    }
    if (attempt === 9) {
      throw new Error("Instagram media container did not become ready in time.");
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  const published = await fetchJson(`${META_GRAPH_BASE}/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      creation_id: containerId,
      access_token: pageToken,
    }),
  });
  const id = String(published.id || "");
  if (!id) {
    throw new Error("Instagram did not return a post id.");
  }
  return {
    platformPostId: id,
    externalPostUrl: connection.profileUrl || "https://www.instagram.com",
    publishedVia: "meta_graph_api",
  };
}

async function uploadXImage(accessToken: string, imageUrl: string) {
  const image = await downloadRemoteImage(imageUrl, 5 * 1024 * 1024);
  let mediaBuffer = image.buffer;
  let mediaType = image.mimeType;

  // Keep SVG assets editable in governance while still satisfying X's raster upload requirements.
  if (mediaType === "image/svg+xml") {
    mediaBuffer = Buffer.from(await sharp(image.buffer, { density: 192 }).png().toBuffer());
    mediaType = "image/png";
  }

  if (!["image/jpeg", "image/png", "image/webp", "image/bmp", "image/pjpeg", "image/tiff"].includes(mediaType)) {
    throw new Error("X direct publish requires a PNG, JPEG, WEBP, BMP, or TIFF asset. SVG fallback is blocked.");
  }
  const result = await fetchJson(`${X_API_BASE}/2/media/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      media: mediaBuffer.toString("base64"),
      media_category: "tweet_image",
      media_type: mediaType,
      shared: false,
    }),
  });
  const mediaId = String(toRecord(result.data).id || "");
  if (!mediaId) {
    throw new Error("X did not return a media id.");
  }
  return mediaId;
}

async function publishToX(connection: SocialConnectionRecord, bundle: ConnectionCredentialBundle, caption: string, assetUrls: string[], link?: string | null) {
  const text = buildXPostText(caption, link);
  const imageUrl = pickImageMediaUrls(assetUrls)[0] || null;
  const publishTweet = async (accessToken: string, includeMedia: boolean) => {
    let mediaId: string | null = null;
    if (includeMedia && imageUrl) {
      mediaId = await uploadXImage(accessToken, imageUrl);
    }
    return fetchJson(`${X_API_BASE}/2/tweets`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        mediaId
          ? {
              text,
              media: {
                media_ids: [mediaId],
              },
            }
          : { text },
      ),
    });
  };

  const shouldRetryAuth = (message: string) =>
    /401|expired|invalid_token|unauthorized|invalid_request|invalid_grant|authorization header|token was invalid/i.test(message);

  const shouldFallbackToTextOnly = (message: string) =>
    /403|forbidden|media.write|media id|unsupported image|tweet_image/i.test(message);

  let result: Record<string, unknown>;
  let publishedVia = imageUrl ? "x_api_v2" : "x_api_v2_text_only";
  try {
    result = await publishTweet(bundle.accessToken, Boolean(imageUrl));
  } catch (error) {
    const message = String((error as Error).message || "");
    if (imageUrl && shouldFallbackToTextOnly(message)) {
      result = await publishTweet(bundle.accessToken, false);
      publishedVia = "x_api_v2_text_only";
    } else if (!shouldRetryAuth(message)) {
      throw error;
    } else {
      const refreshed = await refreshXAccessToken(connection);
      try {
        result = await publishTweet(refreshed.bundle.accessToken, Boolean(imageUrl));
      } catch (retryError) {
        const retryMessage = String((retryError as Error).message || "");
        if (imageUrl && shouldFallbackToTextOnly(retryMessage)) {
          result = await publishTweet(refreshed.bundle.accessToken, false);
          publishedVia = "x_api_v2_text_only";
        } else {
          throw retryError;
        }
      }
    }
  }
  const id = String(toRecord(result.data).id || "");
  if (!id) {
    throw new Error("X did not return a tweet id.");
  }
  return {
    platformPostId: id,
    externalPostUrl: `https://x.com/i/web/status/${id}`,
    publishedVia,
  };
}

function resolveLinkedInAuthorUrn(connection: SocialConnectionRecord) {
  const metadata = parseConnectionMetadata(connection.metadata);
  const authorUrn = String(metadata.authorUrn || "").trim();
  if (authorUrn) {
    return authorUrn;
  }
  const id = String(connection.externalAccountId || "").trim();
  if (!id) return "";
  return id.startsWith("urn:li:") ? id : `urn:li:person:${id}`;
}

async function publishToLinkedIn(connection: SocialConnectionRecord, bundle: ConnectionCredentialBundle, caption: string, link?: string | null) {
  const authorUrn = resolveLinkedInAuthorUrn(connection);
  if (!authorUrn) {
    throw new Error("LinkedIn connection is missing a publishable author id. Sync the connection and try again.");
  }
  const body = {
    author: authorUrn,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text: buildLinkedInPostText(caption, link) },
        shareMediaCategory: link ? "ARTICLE" : "NONE",
        ...(link
          ? {
              media: [
                {
                  status: "READY",
                  originalUrl: link,
                },
              ],
            }
          : {}),
      },
    },
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
    },
  };

  const attempt = async (accessToken: string) => {
    const response = await fetch("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const raw = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      parsed = {};
    }
    if (!response.ok) {
      throw new Error(
        String(parsed.message || parsed.error_description || parsed.serviceErrorCode || raw || `status=${response.status}`),
      );
    }
    return {
      body: parsed,
      restliId: response.headers.get("x-restli-id") || "",
    };
  };

  let result: { body: Record<string, unknown>; restliId: string };
  try {
    result = await attempt(bundle.accessToken);
  } catch (error) {
    if (!/401|403|expired|invalid_token|unauthorized|access token/i.test(String((error as Error).message || ""))) {
      throw error;
    }
    const refreshed = await refreshLinkedInToken(connection);
    result = await attempt(refreshed.bundle.accessToken);
  }
  const id = result.restliId || String(result.body.id || "");
  if (!id) {
    throw new Error("LinkedIn did not return a post id.");
  }
  return {
    platformPostId: id,
    externalPostUrl: `https://www.linkedin.com/feed/update/${id}`,
    publishedVia: "linkedin_ugc_api",
  };
}

function resolveTikTokPrivacyLevel(creatorInfo: Record<string, unknown>) {
  const options = Array.isArray(creatorInfo.privacy_level_options) ? creatorInfo.privacy_level_options : [];
  if (options.includes("PUBLIC_TO_EVERYONE")) return "PUBLIC_TO_EVERYONE";
  if (options.includes("MUTUAL_FOLLOW_FRIENDS")) return "MUTUAL_FOLLOW_FRIENDS";
  if (options.includes("SELF_ONLY")) return "SELF_ONLY";
  return typeof options[0] === "string" ? options[0] : "SELF_ONLY";
}

async function queryTikTokCreatorInfo(accessToken: string) {
  const response = await fetch("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({}),
    cache: "no-store",
  });
  const raw = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    body = {};
  }
  const error = toRecord(body.error);
  if (!response.ok || (error.code && error.code !== "ok")) {
    throw new Error(String(error.message || error.code || raw || `status=${response.status}`));
  }
  return toRecord(body.data);
}

async function publishTikTokVideo(bundle: ConnectionCredentialBundle, connection: SocialConnectionRecord, caption: string, videoUrl: string) {
  const creatorInfo = await queryTikTokCreatorInfo(bundle.accessToken);
  const postInfo = {
    title: buildTikTokCaption(caption, null).slice(0, 2200),
    privacy_level: resolveTikTokPrivacyLevel(creatorInfo),
    disable_comment: Boolean(creatorInfo.comment_disabled),
    disable_duet: Boolean(creatorInfo.duet_disabled),
    disable_stitch: Boolean(creatorInfo.stitch_disabled),
  };

  const parseTikTokResponse = async (response: Response) => {
    const raw = await response.text();
    let body: Record<string, unknown> = {};
    try {
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      body = {};
    }
    const error = toRecord(body.error);
    if (!response.ok || (error.code && error.code !== "ok")) {
      throw new Error(String(error.message || error.code || raw || `status=${response.status}`));
    }
    return body;
  };

  try {
    const initial = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bundle.accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        post_info: postInfo,
        source_info: {
          source: "PULL_FROM_URL",
          video_url: videoUrl,
        },
      }),
      cache: "no-store",
    });
    const body = await parseTikTokResponse(initial);
    const publishId = String(toRecord(body.data).publish_id || "").trim();
    if (!publishId) {
      throw new Error("TikTok did not return a publish id.");
    }
    return {
      platformPostId: publishId,
      externalPostUrl: connection.profileUrl || "https://www.tiktok.com",
      publishedVia: "tiktok_content_posting_api",
    };
  } catch (error) {
    if (!/verify|ownership|verified domain|url prefix/i.test(String((error as Error).message || ""))) {
      throw error;
    }
    const media = await downloadRemoteVideo(videoUrl, 256 * 1024 * 1024);
    const init = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bundle.accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        post_info: postInfo,
        source_info: {
          source: "FILE_UPLOAD",
          video_size: media.buffer.length,
          chunk_size: media.buffer.length,
          total_chunk_count: 1,
        },
      }),
      cache: "no-store",
    });
    const initBody = await parseTikTokResponse(init);
    const data = toRecord(initBody.data);
    const publishId = String(data.publish_id || "").trim();
    const uploadUrl = String(data.upload_url || "").trim();
    if (!publishId || !uploadUrl) {
      throw new Error("TikTok file upload init did not return publish_id and upload_url.");
    }
    const upload = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": media.mimeType,
        "Content-Length": String(media.buffer.length),
        "Content-Range": `bytes 0-${media.buffer.length - 1}/${media.buffer.length}`,
      },
      body: new Uint8Array(media.buffer),
    });
    if (!upload.ok) {
      const uploadRaw = await upload.text().catch(() => "");
      throw new Error(uploadRaw || `TikTok video upload failed status=${upload.status}`);
    }
    return {
      platformPostId: publishId,
      externalPostUrl: connection.profileUrl || "https://www.tiktok.com",
      publishedVia: "tiktok_content_posting_api",
    };
  }
}

async function publishTikTokPhoto(bundle: ConnectionCredentialBundle, connection: SocialConnectionRecord, caption: string, photoUrls: string[]) {
  const creatorInfo = await queryTikTokCreatorInfo(bundle.accessToken);
  const response = await fetch("https://open.tiktokapis.com/v2/post/publish/content/init/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bundle.accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({
      post_mode: "DIRECT_POST",
      media_type: "PHOTO",
      post_info: {
        title: buildTikTokCaption(caption, null).slice(0, 90),
        description: buildTikTokCaption(caption, null).slice(0, 4000),
        privacy_level: resolveTikTokPrivacyLevel(creatorInfo),
        disable_comment: Boolean(creatorInfo.comment_disabled),
      },
      source_info: {
        source: "PULL_FROM_URL",
        photo_images: photoUrls.slice(0, 35),
        photo_cover_index: 0,
      },
    }),
    cache: "no-store",
  });
  const raw = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    body = {};
  }
  const error = toRecord(body.error);
  if (!response.ok || (error.code && error.code !== "ok")) {
    throw new Error(String(error.message || error.code || raw || `status=${response.status}`));
  }
  const publishId = String(toRecord(body.data).publish_id || "").trim();
  if (!publishId) {
    throw new Error("TikTok did not return a publish id.");
  }
  return {
    platformPostId: publishId,
    externalPostUrl: connection.profileUrl || "https://www.tiktok.com",
    publishedVia: "tiktok_content_posting_api",
  };
}

async function publishToYouTube(connection: SocialConnectionRecord, bundle: ConnectionCredentialBundle, caption: string, assetUrls: string[], link?: string | null) {
  const videoUrl = pickVideoMediaUrl(assetUrls, null);
  const imageUrl = pickImageMediaUrls(assetUrls)[0] || null;
  let media: { buffer: Buffer; mimeType: string };
  if (videoUrl) {
    media = await downloadRemoteVideo(videoUrl, 256 * 1024 * 1024);
  } else if (imageUrl) {
    const image = await downloadRemoteImage(imageUrl, 20 * 1024 * 1024);
    media = {
      buffer: await convertImageBufferToMp4(image.buffer, image.ext),
      mimeType: "video/mp4",
    };
  } else {
    throw new Error("YouTube requires at least one video or image asset URL.");
  }

  const attempt = async (accessToken: string) => {
    const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": media.mimeType,
        "X-Upload-Content-Length": String(media.buffer.length),
      },
      body: JSON.stringify({
        snippet: {
          title: buildYouTubeTitle(caption),
          description: buildYouTubeDescription(caption, link),
        },
        status: {
          privacyStatus: "public",
        },
      }),
      cache: "no-store",
    });
    if (!init.ok) {
      const raw = await init.text();
      throw new Error(raw || `YouTube upload init failed status=${init.status}`);
    }
    const uploadUrl = init.headers.get("location");
    if (!uploadUrl) {
      throw new Error("YouTube upload init did not return a session URL.");
    }
    const upload = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": media.mimeType,
        "Content-Length": String(media.buffer.length),
        "Content-Range": `bytes 0-${media.buffer.length - 1}/${media.buffer.length}`,
      },
      body: new Uint8Array(media.buffer),
    });
    const raw = await upload.text();
    let body: Record<string, unknown> = {};
    try {
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      body = {};
    }
    if (!upload.ok) {
      throw new Error(String(toRecord(body.error).message || raw || `status=${upload.status}`));
    }
    const id = String(body.id || "").trim();
    if (!id) {
      throw new Error("YouTube did not return a video id.");
    }
    return {
      platformPostId: id,
      externalPostUrl: `https://youtu.be/${id}`,
      publishedVia: "youtube_data_api",
    };
  };

  try {
    return await attempt(bundle.accessToken);
  } catch (error) {
    if (!/unauthorized|invalid token|invalid_grant|expired|forbidden|permission/i.test(String((error as Error).message || ""))) {
      throw error;
    }
    const refreshed = await refreshGoogleToken(connection);
    return attempt(refreshed.bundle.accessToken);
  }
}

function ensurePublishableConnection(connection: SocialConnectionRecord | null): asserts connection is SocialConnectionRecord {
  if (!connection) {
    throw new Error("This content job is not linked to a social connection.");
  }
  if (connection.publishMode !== "api") {
    throw new Error("This channel is configured for assisted publishing, not direct API publish.");
  }
}

export async function publishSocialJobForOrg(orgId: string, jobId: string) {
  const validated = await validateSocialJobForOrg(orgId, jobId);
  const job = validated.job;
  if (!job) {
    throw new Error("Content job not found.");
  }
  if (validated.report.final_status !== "approved_for_publish") {
    throw new Error(`Publish blocked: ${validated.report.reasons.join(", ")}`);
  }

  ensurePublishableConnection(job.connection);

  const ensured = await ensureSocialConnectionOperationalForOrg(orgId, job.connection.id);
  const syncedConnection: SocialConnectionRecord = ensured.connection;
  const bundle = ensured.credentialBundle;

  const caption = String(job.caption || "").trim();
  if (!caption) {
    throw new Error("Content job caption is required for publishing.");
  }

  const assetUrls = parseAssetUrls(job.assetUrls);
  const scopes = parseScopes(syncedConnection.scopes);
  const publishLink =
    job.platform === "youtube"
      ? job.destinationUrl || null
      : job.platform === "x"
        ? job.destinationUrl || null
        : job.useLinkPreview
          ? job.destinationUrl || null
          : null;
  const preferLinkPreview = platformSupportsLinkPreview(job.platform) && job.useLinkPreview && Boolean(job.destinationUrl);

  let result: PublishResult;
  if (job.platform === "facebook") {
    result = await publishToFacebook(syncedConnection, bundle, caption, assetUrls, publishLink, preferLinkPreview);
  } else if (job.platform === "instagram") {
    result = await publishToInstagram(syncedConnection, bundle, caption, assetUrls);
  } else if (job.platform === "x") {
    if (!scopes.includes("tweet.write")) {
      throw new Error("X publish permission is missing. Reconnect X with tweet.write.");
    }
    result = await publishToX(syncedConnection, bundle, caption, assetUrls, publishLink);
  } else if (job.platform === "linkedin") {
    if (!scopes.includes("w_member_social")) {
      throw new Error("LinkedIn publish permission is missing. Reconnect LinkedIn with w_member_social.");
    }
    result = await publishToLinkedIn(syncedConnection, bundle, caption, publishLink);
  } else if (job.platform === "tiktok") {
    if (!scopes.includes("video.publish") && !scopes.includes("video.upload")) {
      throw new Error("TikTok publish permission is missing. Reconnect TikTok with video.publish.");
    }
    const videoUrl = pickVideoMediaUrl(assetUrls, job.format);
    try {
      result = videoUrl
        ? await publishTikTokVideo(bundle, syncedConnection, caption, videoUrl)
        : await publishTikTokPhoto(bundle, syncedConnection, caption, pickImageMediaUrls(assetUrls));
    } catch (error) {
      if (!/unauthoriz|invalid_token|access token|expired/i.test(String((error as Error).message || ""))) {
        throw error;
      }
      const refreshed = await refreshTikTokToken(syncedConnection);
      result = videoUrl
        ? await publishTikTokVideo(refreshed.bundle, syncedConnection, caption, videoUrl)
        : await publishTikTokPhoto(refreshed.bundle, syncedConnection, caption, pickImageMediaUrls(assetUrls));
    }
  } else if (job.platform === "youtube") {
    if (!scopes.includes("https://www.googleapis.com/auth/youtube.upload") && !scopes.includes("youtube.upload")) {
      throw new Error("YouTube upload permission is missing. Reconnect YouTube with youtube.upload.");
    }
    result = await publishToYouTube(syncedConnection, bundle, caption, assetUrls);
  } else {
    throw new Error("This platform does not support direct API publishing yet.");
  }

  const updatedJob = await prisma.migraMarketContentJob.update({
    where: { id: job.id },
    data: {
      status: "published",
      publishedAt: new Date(),
      externalPostUrl: result.externalPostUrl,
      validationStatus: "approved_for_publish",
      publishLogs: stringifyJson({
        latestPublish: {
          publishedVia: result.publishedVia,
          platformPostId: result.platformPostId,
          externalPostUrl: result.externalPostUrl,
          destinationUrl: job.destinationUrl || null,
          publishedAt: new Date().toISOString(),
        },
      }),
    },
    include: {
      brief: true,
      connection: true,
      captionVariant: true,
      selectedAsset: true,
      validations: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  return {
    job: updatedJob,
    publishedVia: result.publishedVia,
    platformPostId: result.platformPostId,
    externalPostUrl: result.externalPostUrl,
  };
}
