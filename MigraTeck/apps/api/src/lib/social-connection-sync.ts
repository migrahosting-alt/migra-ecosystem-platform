import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { getDb } from "./db.js";

const META_GRAPH_BASE = "https://graph.facebook.com/v24.0";
const X_API_BASE = "https://api.x.com";
const REFRESHABLE_PLATFORMS = new Set([
  "facebook",
  "instagram",
  "linkedin",
  "youtube",
  "x",
  "tiktok",
]);

type JsonMap = Record<string, unknown>;

type SocialConnectionRecord = {
  id: string;
  orgId: string;
  platform: string;
  handle: string;
  profileType: string;
  profileUrl: string | null;
  publishMode: string;
  accessModel: string;
  status: string;
  externalAccountId: string | null;
  scopes: unknown;
  metadata: JsonMap | null;
  credentialCiphertext: string | null;
  refreshTokenCiphertext: string | null;
  tokenExpiresAt: Date | null;
  lastVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type ConnectionCredentialBundle = {
  accessToken: string;
  publishAccessToken?: string | null;
};

type HealthState =
  | "healthy"
  | "disconnected"
  | "reconnect_required"
  | "token_expiring"
  | "verification_stale";

type RecommendedAction =
  | "connect"
  | "reconnect"
  | "refresh"
  | "sync"
  | "monitor";

export type SocialConnectionHealth = {
  state: HealthState;
  summary: string;
  recommendedAction: RecommendedAction;
  connected: boolean;
  canAutoRefresh: boolean;
  tokenExpired: boolean;
  tokenExpiresSoon: boolean;
  verificationStale: boolean;
  missingAccountBinding: boolean;
  requiresReconnect: boolean;
  needsAttention: boolean;
  lastSyncError: string | null;
  expiresInHours: number | null;
};

export type SocialSyncStats = {
  processed: number;
  refreshed: number;
  synced: number;
  reconnectRequired: number;
  failed: number;
  skipped: number;
  scanned: number;
  paused: boolean;
};

const CONNECTION_SELECT =
  'id,"orgId",platform,handle,"profileType","profileUrl","publishMode","accessModel",status,"externalAccountId",scopes,metadata,"credentialCiphertext","refreshTokenCiphertext","tokenExpiresAt","lastVerifiedAt","createdAt","updatedAt"';

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function refreshWindowHours(): number {
  return parsePositiveInt(
    process.env.SOCIAL_CONNECTION_SYNC_REFRESH_WINDOW_HOURS,
    72,
  );
}

function verificationStaleHours(): number {
  return parsePositiveInt(
    process.env.SOCIAL_CONNECTION_SYNC_VERIFICATION_STALE_HOURS,
    24,
  );
}

function errorRetryMinutes(): number {
  return parsePositiveInt(
    process.env.SOCIAL_CONNECTION_SYNC_ERROR_RETRY_MINUTES,
    60,
  );
}

export function socialConnectionSyncBatchSize(): number {
  return Math.min(
    parsePositiveInt(process.env.SOCIAL_CONNECTION_SYNC_BATCH_SIZE, 25),
    100,
  );
}

function requestTimeoutMs(): number {
  return Math.min(
    parsePositiveInt(process.env.SOCIAL_CONNECTION_PROVIDER_TIMEOUT_MS, 15000),
    60000,
  );
}

function asRecord(value: unknown): JsonMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...(value as JsonMap) };
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function readMetadataString(metadata: unknown, key: string): string | null {
  return asString(asRecord(metadata)[key]);
}

function shouldRequireReconnect(message: string): boolean {
  return /reconnect|invalid[_\s-]?grant|invalid[_\s-]?token|token.{0,32}invalid|invalid.{0,32}token|access[_\s-]?denied|expired|revoked|unauthoriz|authorization|oauth/i.test(
    message,
  );
}

function metadataDate(metadata: unknown, key: string): Date | null {
  const value = readMetadataString(metadata, key);
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function socialConnectionRetryBackoffActive(
  connection: Pick<SocialConnectionRecord, "metadata">,
  action: RecommendedAction,
  now = new Date(),
): boolean {
  if (action !== "refresh" && action !== "sync") return false;

  const attemptedAt =
    action === "refresh"
      ? metadataDate(connection.metadata, "lastTokenRefreshAttemptAt") ??
        metadataDate(connection.metadata, "lastSyncAttemptAt")
      : metadataDate(connection.metadata, "lastSyncAttemptAt");

  if (!attemptedAt) return false;

  const retryAt =
    attemptedAt.getTime() + errorRetryMinutes() * 60 * 1000;
  return retryAt > now.getTime();
}

export function assessSocialConnectionHealth(
  connection: Pick<
    SocialConnectionRecord,
    | "platform"
    | "accessModel"
    | "status"
    | "externalAccountId"
    | "metadata"
    | "tokenExpiresAt"
    | "credentialCiphertext"
    | "lastVerifiedAt"
  >,
  now = new Date(),
): SocialConnectionHealth {
  const connected = Boolean(connection.credentialCiphertext);
  const oauthManaged =
    String(connection.accessModel || "").trim().toLowerCase() === "oauth";
  const canAutoRefresh =
    oauthManaged &&
    connected &&
    REFRESHABLE_PLATFORMS.has(
      String(connection.platform || "").trim().toLowerCase(),
    );
  const refreshWindowMs = refreshWindowHours() * 60 * 60 * 1000;
  const verificationWindowMs = verificationStaleHours() * 60 * 60 * 1000;
  const tokenExpiresAt = connection.tokenExpiresAt || null;
  const lastVerifiedAt = connection.lastVerifiedAt || null;
  const lastSyncError = readMetadataString(connection.metadata, "lastSyncError");
  const tokenExpired = Boolean(
    tokenExpiresAt && tokenExpiresAt.getTime() <= now.getTime(),
  );
  const tokenExpiresSoon = Boolean(
    tokenExpiresAt &&
      tokenExpiresAt.getTime() > now.getTime() &&
      tokenExpiresAt.getTime() - now.getTime() <= refreshWindowMs,
  );
  const verificationStale = Boolean(
    connected &&
      (!lastVerifiedAt ||
        now.getTime() - lastVerifiedAt.getTime() >= verificationWindowMs),
  );
  const missingAccountBinding = connected && !connection.externalAccountId;
  const statusRequiresReconnect =
    String(connection.status || "").trim().toLowerCase() ===
    "reconnect_required";
  const requiresReconnect =
    statusRequiresReconnect ||
    shouldRequireReconnect(lastSyncError || "") ||
    (oauthManaged && connected && tokenExpired && !canAutoRefresh);

  let state: HealthState = "healthy";
  let recommendedAction: RecommendedAction = "monitor";
  let summary = "Healthy";

  if (!connected && oauthManaged) {
    state = "disconnected";
    recommendedAction = "connect";
    summary = "OAuth disconnected";
  } else if (requiresReconnect) {
    state = "reconnect_required";
    recommendedAction = "reconnect";
    summary = "Reconnect required";
  } else if (tokenExpired || tokenExpiresSoon) {
    state = "token_expiring";
    recommendedAction = canAutoRefresh ? "refresh" : "reconnect";
    summary = tokenExpired ? "Token expired" : "Token refresh due soon";
  } else if (
    verificationStale ||
    missingAccountBinding ||
    Boolean(lastSyncError) ||
    String(connection.status || "").trim().toLowerCase() !== "ready"
  ) {
    state = "verification_stale";
    recommendedAction = "sync";
    summary = missingAccountBinding
      ? "Account binding needs sync"
      : "Verification sync overdue";
  }

  return {
    state,
    summary,
    recommendedAction,
    connected,
    canAutoRefresh,
    tokenExpired,
    tokenExpiresSoon,
    verificationStale,
    missingAccountBinding,
    requiresReconnect,
    needsAttention: state !== "healthy",
    lastSyncError,
    expiresInHours:
      tokenExpiresAt && tokenExpiresAt.getTime() > now.getTime()
        ? Math.round(
            ((tokenExpiresAt.getTime() - now.getTime()) / (60 * 60 * 1000)) *
              10,
          ) / 10
        : null,
  };
}

function encryptionKey(): Buffer {
  const raw =
    process.env.MIGRAMARKET_SOCIAL_CONNECT_ENCRYPTION_KEY?.trim() ||
    process.env.LAUNCH_TOKEN_SECRET?.trim();
  if (!raw || raw.length < 16) {
    throw new Error(
      "MIGRAMARKET_SOCIAL_CONNECT_ENCRYPTION_KEY is required for social OAuth connections.",
    );
  }
  return createHash("sha256").update(raw).digest();
}

export function socialConnectionEncryptionReady(): boolean {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}

function decryptSocialSecret(payload: string): string {
  const [version, ivRaw, tagRaw, ciphertextRaw] = payload.split(":");
  if (version !== "v1" || !ivRaw || !tagRaw || !ciphertextRaw) {
    throw new Error("Invalid encrypted social secret payload.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivRaw, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function encryptSocialSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

function parseCredentialBundle(payload: string): ConnectionCredentialBundle {
  const plaintext = decryptSocialSecret(payload);
  try {
    const parsed = JSON.parse(plaintext) as ConnectionCredentialBundle;
    if (
      parsed &&
      typeof parsed.accessToken === "string" &&
      parsed.accessToken.trim()
    ) {
      return {
        accessToken: parsed.accessToken,
        publishAccessToken:
          typeof parsed.publishAccessToken === "string"
            ? parsed.publishAccessToken
            : null,
      };
    }
  } catch {
    // Legacy single-token plaintext inside the encrypted envelope.
  }
  return { accessToken: plaintext, publishAccessToken: null };
}

function encryptCredentialBundle(bundle: ConnectionCredentialBundle): string {
  return encryptSocialSecret(
    JSON.stringify({
      accessToken: bundle.accessToken,
      publishAccessToken: bundle.publishAccessToken || null,
    }),
  );
}

function getCredentialBundle(
  connection: SocialConnectionRecord,
): ConnectionCredentialBundle {
  if (!connection.credentialCiphertext) {
    throw new Error(
      "This connection is not authenticated. Reconnect it with OAuth first.",
    );
  }
  return parseCredentialBundle(connection.credentialCiphertext);
}

function getRefreshToken(connection: SocialConnectionRecord): string | null {
  if (!connection.refreshTokenCiphertext) return null;
  return decryptSocialSecret(connection.refreshTokenCiphertext);
}

function toOptionalDate(seconds: unknown): Date | null {
  const raw =
    typeof seconds === "number"
      ? seconds
      : typeof seconds === "string"
        ? Number.parseInt(seconds, 10)
        : Number.NaN;
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return new Date(Date.now() + raw * 1000);
}

async function fetchJson(
  url: string | URL,
  init: RequestInit = {},
): Promise<JsonMap> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs());
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const raw = await response.text();
    let body: JsonMap = {};
    try {
      body = raw ? (JSON.parse(raw) as JsonMap) : {};
    } catch {
      body = {};
    }
    if (!response.ok) {
      const errorBody = asRecord(body.error);
      const message =
        asString(errorBody.message) ||
        asString(body.error_description) ||
        asString(body.message) ||
        raw ||
        "status=" + response.status;
      throw new Error(message);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

type ConnectionPatch = Partial<
  Pick<
    SocialConnectionRecord,
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
  >
>;

async function updateConnection(
  id: string,
  patch: ConnectionPatch,
): Promise<SocialConnectionRecord> {
  const columns: Record<keyof ConnectionPatch, string> = {
    handle: "handle",
    profileType: '"profileType"',
    profileUrl: '"profileUrl"',
    publishMode: '"publishMode"',
    accessModel: '"accessModel"',
    status: "status",
    externalAccountId: '"externalAccountId"',
    scopes: "scopes",
    metadata: "metadata",
    credentialCiphertext: '"credentialCiphertext"',
    refreshTokenCiphertext: '"refreshTokenCiphertext"',
    tokenExpiresAt: '"tokenExpiresAt"',
    lastVerifiedAt: '"lastVerifiedAt"',
  };
  const values: unknown[] = [];
  const sets: string[] = [];

  for (const [keyRaw, value] of Object.entries(patch)) {
    const key = keyRaw as keyof ConnectionPatch;
    const column = columns[key];
    if (!column) continue;
    values.push(
      key === "metadata" || key === "scopes"
        ? value === null
          ? null
          : JSON.stringify(value)
        : value,
    );
    const cast = key === "metadata" || key === "scopes" ? "::jsonb" : "";
    sets.push(column + "=$" + values.length + cast);
  }

  if (sets.length === 0) {
    const unchanged = await getDb().query<SocialConnectionRecord>(
      "SELECT " + CONNECTION_SELECT + ' FROM "MigraMarketSocialConnection" WHERE id=$1',
      [id],
    );
    if (!unchanged.rows[0]) throw new Error("Social connection not found.");
    return unchanged.rows[0];
  }

  values.push(id);
  const result = await getDb().query<SocialConnectionRecord>(
    'UPDATE "MigraMarketSocialConnection" SET ' +
      sets.join(",") +
      ',"updatedAt"=NOW() WHERE id=$' +
      values.length +
      " RETURNING " +
      CONNECTION_SELECT,
    values,
  );
  if (!result.rows[0]) throw new Error("Social connection not found.");
  return result.rows[0];
}

async function updateConnectionMetadata(
  connection: SocialConnectionRecord,
  patch: JsonMap,
  status?: string,
): Promise<SocialConnectionRecord> {
  return updateConnection(connection.id, {
    ...(status ? { status } : {}),
    metadata: {
      ...asRecord(connection.metadata),
      ...patch,
    },
  });
}

async function recordConnectionSyncError(
  connection: SocialConnectionRecord,
  message: string,
): Promise<SocialConnectionRecord> {
  return updateConnection(connection.id, {
    status: shouldRequireReconnect(message)
      ? "reconnect_required"
      : connection.status,
    metadata: {
      ...asRecord(connection.metadata),
      lastSyncError: message,
      lastSyncAttemptAt: new Date().toISOString(),
    },
    lastVerifiedAt: new Date(),
  });
}

async function getMetaUserPages(accessToken: string) {
  const url = new URL(META_GRAPH_BASE + "/me/accounts");
  url.searchParams.set(
    "fields",
    "id,name,access_token,category,picture.type(large),tasks",
  );
  url.searchParams.set("access_token", accessToken);
  const data = await fetchJson(url);
  const pages = Array.isArray(data.data) ? data.data : [];
  return pages
    .map((item) => {
      const page = asRecord(item);
      const picture = asRecord(asRecord(page.picture).data);
      return {
        id: String(page.id || ""),
        name: String(page.name || ""),
        accessToken: String(page.access_token || ""),
        category: String(page.category || "Business"),
        picture: String(picture.url || ""),
      };
    })
    .filter((page) => page.id && page.name && page.accessToken);
}

async function getInstagramBusinessAccount(
  pageId: string,
  pageAccessToken: string,
) {
  const url = new URL(
    META_GRAPH_BASE + "/" + encodeURIComponent(pageId),
  );
  url.searchParams.set(
    "fields",
    "instagram_business_account{id,username,followers_count,media_count,profile_picture_url}",
  );
  url.searchParams.set("access_token", pageAccessToken);
  const data = await fetchJson(url);
  const account = asRecord(data.instagram_business_account);
  if (!account.id || !account.username) return null;
  return {
    id: String(account.id),
    username: String(account.username),
    followers: Number(account.followers_count || 0),
    mediaCount: Number(account.media_count || 0),
    picture: asString(account.profile_picture_url),
  };
}

function matchesTarget(
  connection: SocialConnectionRecord,
  candidates: Array<{ id: string; name: string }>,
) {
  const metadata = asRecord(connection.metadata);
  const byId = String(
    connection.externalAccountId || metadata.selectedPageId || "",
  ).trim();
  if (byId) {
    const match = candidates.find((item) => item.id === byId);
    if (match) return match;
  }
  const expectedHandle = connection.handle
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
  if (expectedHandle) {
    const match = candidates.find(
      (item) =>
        item.name.trim().toLowerCase().replace(/^@/, "") === expectedHandle,
    );
    if (match) return match;
  }
  return candidates[0] || null;
}

async function syncFacebookConnection(
  connection: SocialConnectionRecord,
  bundle: ConnectionCredentialBundle,
) {
  const pages = await getMetaUserPages(bundle.accessToken);
  if (!pages.length) {
    throw new Error("No Facebook pages were found for this Meta connection.");
  }
  const selected = matchesTarget(
    connection,
    pages.map((page) => ({ id: page.id, name: page.name })),
  );
  if (!selected) throw new Error("No publishable Facebook page was found.");
  const page = pages.find((item) => item.id === selected.id);
  if (!page) throw new Error("No publishable Facebook page was found.");
  return updateConnection(connection.id, {
    handle: page.name,
    profileType: "page",
    profileUrl: "https://www.facebook.com/" + page.id,
    publishMode: "api",
    accessModel: "oauth",
    status: "ready",
    externalAccountId: page.id,
    metadata: {
      ...asRecord(connection.metadata),
      connectionLabel: page.name,
      displayName: page.name,
      avatarUrl: page.picture || null,
      pageId: page.id,
      pageName: page.name,
      pageCategory: page.category,
      lastSyncError: null,
    },
    credentialCiphertext: encryptCredentialBundle({
      accessToken: bundle.accessToken,
      publishAccessToken: page.accessToken,
    }),
    lastVerifiedAt: new Date(),
  });
}

async function syncInstagramConnection(
  connection: SocialConnectionRecord,
  bundle: ConnectionCredentialBundle,
) {
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
    const account = await getInstagramBusinessAccount(
      page.id,
      page.accessToken,
    ).catch(() => null);
    if (!account) continue;
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
    throw new Error(
      "No Instagram business account was found for this Meta connection.",
    );
  }
  const metadata = asRecord(connection.metadata);
  const selectedId = String(
    connection.externalAccountId || metadata.instagramAccountId || "",
  ).trim();
  const desiredHandle = connection.handle
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
  const selected =
    candidates.find((item) => item.igId === selectedId) ||
    candidates.find(
      (item) => item.username.trim().toLowerCase() === desiredHandle,
    ) ||
    candidates[0];
  if (!selected) throw new Error("No publishable Instagram account was found.");
  return updateConnection(connection.id, {
    handle: "@" + selected.username.replace(/^@/, ""),
    profileType: "business",
    profileUrl:
      "https://www.instagram.com/" +
      selected.username.replace(/^@/, ""),
    publishMode: "api",
    accessModel: "oauth",
    status: "ready",
    externalAccountId: selected.igId,
    metadata: {
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
    },
    credentialCiphertext: encryptCredentialBundle({
      accessToken: bundle.accessToken,
      publishAccessToken: selected.pageAccessToken,
    }),
    lastVerifiedAt: new Date(),
  });
}

async function syncLinkedInConnection(
  connection: SocialConnectionRecord,
  bundle: ConnectionCredentialBundle,
) {
  const data = await fetchJson("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: "Bearer " + bundle.accessToken },
  });
  const sub = String(data.sub || "");
  if (!sub) {
    throw new Error("LinkedIn did not return a publishable member identity.");
  }
  const email = asString(data.email);
  const name =
    asString(data.name) ||
    [data.given_name, data.family_name]
      .filter((item) => typeof item === "string" && item)
      .join(" ") ||
    email ||
    connection.handle;
  return updateConnection(connection.id, {
    handle: String(name),
    profileType: "profile",
    publishMode: "api",
    accessModel: "oauth",
    status: "ready",
    externalAccountId: sub,
    metadata: {
      ...asRecord(connection.metadata),
      connectionLabel: name,
      displayName: name,
      avatarUrl: asString(data.picture),
      email,
      authorUrn: "urn:li:person:" + sub,
      lastSyncError: null,
    },
    lastVerifiedAt: new Date(),
  });
}

async function syncYouTubeConnection(
  connection: SocialConnectionRecord,
  bundle: ConnectionCredentialBundle,
) {
  const data = await fetchJson(
    "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true",
    { headers: { Authorization: "Bearer " + bundle.accessToken } },
  );
  const items = Array.isArray(data.items) ? data.items : [];
  const channels = items
    .map((item) => {
      const channel = asRecord(item);
      const snippet = asRecord(channel.snippet);
      const statistics = asRecord(channel.statistics);
      return {
        id: String(channel.id || ""),
        title: String(snippet.title || ""),
        customUrl: asString(snippet.customUrl),
        thumbnails: asRecord(snippet.thumbnails),
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
  const channel = selected
    ? channels.find((item) => item.id === selected.id)
    : null;
  if (!channel) throw new Error("No publishable YouTube channel was found.");
  const avatarUrl =
    asString(asRecord(channel.thumbnails.default).url) ||
    asString(asRecord(channel.thumbnails.medium).url) ||
    asString(asRecord(channel.thumbnails.high).url);
  return updateConnection(connection.id, {
    handle: channel.title,
    profileType: "channel",
    profileUrl: "https://www.youtube.com/channel/" + channel.id,
    publishMode: "api",
    accessModel: "oauth",
    status: "ready",
    externalAccountId: channel.id,
    metadata: {
      ...asRecord(connection.metadata),
      connectionLabel: channel.title,
      displayName: channel.title,
      avatarUrl,
      channelId: channel.id,
      customUrl: channel.customUrl,
      followers: channel.subscriberCount,
      videoCount: channel.videoCount,
      viewCount: channel.viewCount,
      lastSyncError: null,
    },
    lastVerifiedAt: new Date(),
  });
}

async function syncXConnection(
  connection: SocialConnectionRecord,
  bundle: ConnectionCredentialBundle,
) {
  const data = await fetchJson(
    X_API_BASE +
      "/2/users/me?user.fields=profile_image_url,username,name,description,public_metrics",
    { headers: { Authorization: "Bearer " + bundle.accessToken } },
  );
  const user = asRecord(data.data);
  const metrics = asRecord(user.public_metrics);
  const username = String(user.username || "");
  const name = String(user.name || username || connection.handle);
  const id = String(user.id || "");
  if (!id || !username) {
    throw new Error("X did not return a publishable profile.");
  }
  return updateConnection(connection.id, {
    handle: "@" + username.replace(/^@/, ""),
    profileType: "profile",
    profileUrl: "https://x.com/" + username.replace(/^@/, ""),
    publishMode: "api",
    accessModel: "oauth",
    status: "ready",
    externalAccountId: id,
    metadata: {
      ...asRecord(connection.metadata),
      connectionLabel: name,
      displayName: name,
      avatarUrl: asString(user.profile_image_url),
      username,
      followers: Number(metrics.followers_count || 0),
      following: Number(metrics.following_count || 0),
      postsCount: Number(metrics.tweet_count || 0),
      lastSyncError: null,
    },
    lastVerifiedAt: new Date(),
  });
}

async function syncTikTokConnection(
  connection: SocialConnectionRecord,
  bundle: ConnectionCredentialBundle,
) {
  const data = await fetchJson(
    "https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,display_name,avatar_url,username,profile_deep_link,follower_count,following_count,likes_count,video_count",
    { headers: { Authorization: "Bearer " + bundle.accessToken } },
  );
  const user = asRecord(asRecord(data.data).user);
  const openId = String(user.open_id || "");
  const username = String(user.username || "");
  const displayName = String(
    user.display_name || username || connection.handle,
  );
  if (!openId) {
    throw new Error("TikTok did not return a publishable profile.");
  }
  return updateConnection(connection.id, {
    handle: username ? "@" + username.replace(/^@/, "") : displayName,
    profileType: "profile",
    profileUrl: asString(user.profile_deep_link) || connection.profileUrl,
    publishMode: "api",
    accessModel: "oauth",
    status: "ready",
    externalAccountId: openId,
    metadata: {
      ...asRecord(connection.metadata),
      connectionLabel: displayName,
      displayName,
      avatarUrl: asString(user.avatar_url),
      username: username || null,
      followers: Number(user.follower_count || 0),
      following: Number(user.following_count || 0),
      likes: Number(user.likes_count || 0),
      postsCount: Number(user.video_count || 0),
      lastSyncError: null,
    },
    lastVerifiedAt: new Date(),
  });
}

async function syncLoadedSocialConnection(
  connection: SocialConnectionRecord,
  bundle: ConnectionCredentialBundle,
) {
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
                  : await updateConnection(connection.id, {
                      lastVerifiedAt: new Date(),
                      metadata: {
                        ...asRecord(connection.metadata),
                        lastSyncError: null,
                      },
                    });
    return {
      connection: refreshed,
      credentialBundle: getCredentialBundle(refreshed),
      profileSynced: true,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "sync_failed";
    const updated = await recordConnectionSyncError(connection, message);
    throw Object.assign(new Error(message), { connection: updated });
  }
}

async function refreshXAccessToken(connection: SocialConnectionRecord) {
  const refreshToken = getRefreshToken(connection);
  const clientId = process.env.MIGRAMARKET_X_CLIENT_ID?.trim();
  const clientSecret = process.env.MIGRAMARKET_X_CLIENT_SECRET?.trim();
  if (!refreshToken || !clientId) {
    throw new Error("X refresh is not available. Reconnect the account.");
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  if (clientSecret) {
    headers.Authorization =
      "Basic " +
      Buffer.from(clientId + ":" + clientSecret).toString("base64");
  } else {
    body.set("client_id", clientId);
  }
  const token = await fetchJson(X_API_BASE + "/2/oauth2/token", {
    method: "POST",
    headers,
    body,
  });
  const bundle = {
    ...getCredentialBundle(connection),
    accessToken: String(token.access_token || ""),
  };
  return {
    connection: await updateConnection(connection.id, {
      credentialCiphertext: encryptCredentialBundle(bundle),
      refreshTokenCiphertext:
        asString(token.refresh_token)
          ? encryptSocialSecret(String(token.refresh_token))
          : connection.refreshTokenCiphertext,
      tokenExpiresAt: toOptionalDate(token.expires_in),
      scopes: Array.isArray(token.scope)
        ? token.scope
        : connection.scopes,
      lastVerifiedAt: new Date(),
    }),
    bundle,
  };
}

async function refreshLinkedInToken(connection: SocialConnectionRecord) {
  const refreshToken = getRefreshToken(connection);
  const clientId = process.env.MIGRAMARKET_LINKEDIN_CLIENT_ID?.trim();
  const clientSecret =
    process.env.MIGRAMARKET_LINKEDIN_CLIENT_SECRET?.trim();
  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error(
      "LinkedIn refresh is not available. Reconnect the account.",
    );
  }
  const token = await fetchJson(
    "https://www.linkedin.com/oauth/v2/accessToken",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    },
  );
  const bundle = {
    ...getCredentialBundle(connection),
    accessToken: String(token.access_token || ""),
  };
  return {
    connection: await updateConnection(connection.id, {
      credentialCiphertext: encryptCredentialBundle(bundle),
      refreshTokenCiphertext: asString(token.refresh_token)
        ? encryptSocialSecret(String(token.refresh_token))
        : connection.refreshTokenCiphertext,
      tokenExpiresAt: toOptionalDate(token.expires_in),
      lastVerifiedAt: new Date(),
    }),
    bundle,
  };
}

async function refreshGoogleToken(connection: SocialConnectionRecord) {
  const refreshToken = getRefreshToken(connection);
  const clientId = process.env.MIGRAMARKET_GOOGLE_CLIENT_ID?.trim();
  const clientSecret =
    process.env.MIGRAMARKET_GOOGLE_CLIENT_SECRET?.trim();
  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error("Google refresh is not available. Reconnect the account.");
  }
  const token = await fetchJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const bundle = {
    ...getCredentialBundle(connection),
    accessToken: String(token.access_token || ""),
  };
  return {
    connection: await updateConnection(connection.id, {
      credentialCiphertext: encryptCredentialBundle(bundle),
      tokenExpiresAt: toOptionalDate(token.expires_in),
      lastVerifiedAt: new Date(),
    }),
    bundle,
  };
}

async function refreshTikTokToken(connection: SocialConnectionRecord) {
  const refreshToken = getRefreshToken(connection);
  const clientKey = process.env.MIGRAMARKET_TIKTOK_CLIENT_KEY?.trim();
  const clientSecret =
    process.env.MIGRAMARKET_TIKTOK_CLIENT_SECRET?.trim();
  if (!refreshToken || !clientKey || !clientSecret) {
    throw new Error("TikTok refresh is not available. Reconnect the account.");
  }
  const token = await fetchJson(
    "https://open.tiktokapis.com/v2/oauth/token/",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    },
  );
  const root =
    token.data && typeof token.data === "object"
      ? asRecord(token.data)
      : token;
  const bundle = {
    ...getCredentialBundle(connection),
    accessToken: String(root.access_token || ""),
  };
  return {
    connection: await updateConnection(connection.id, {
      credentialCiphertext: encryptCredentialBundle(bundle),
      refreshTokenCiphertext: asString(root.refresh_token)
        ? encryptSocialSecret(String(root.refresh_token))
        : connection.refreshTokenCiphertext,
      tokenExpiresAt: toOptionalDate(root.expires_in),
      scopes: asString(root.scope)
        ? normalizeStringList(root.scope)
        : connection.scopes,
      lastVerifiedAt: new Date(),
    }),
    bundle,
  };
}

async function refreshMetaAccessToken(connection: SocialConnectionRecord) {
  const clientId = process.env.MIGRAMARKET_META_CLIENT_ID?.trim();
  const clientSecret =
    process.env.MIGRAMARKET_META_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Meta refresh is not available. Reconnect the account.");
  }
  const currentBundle = getCredentialBundle(connection);
  const url = new URL(META_GRAPH_BASE + "/oauth/access_token");
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("client_secret", clientSecret);
  url.searchParams.set("fb_exchange_token", currentBundle.accessToken);
  const token = await fetchJson(url);
  const accessToken = String(token.access_token || "").trim();
  if (!accessToken) {
    throw new Error("Meta refresh did not return an access token.");
  }
  const bundle = { ...currentBundle, accessToken };
  return {
    connection: await updateConnection(connection.id, {
      credentialCiphertext: encryptCredentialBundle(bundle),
      tokenExpiresAt: toOptionalDate(token.expires_in),
      lastVerifiedAt: new Date(),
    }),
    bundle,
  };
}

async function refreshConnectionAccessTokenIfNeeded(
  connection: SocialConnectionRecord,
  force = false,
) {
  const health = assessSocialConnectionHealth(connection);
  if (!connection.credentialCiphertext) {
    throw new Error(
      "This connection is not authenticated. Reconnect it with OAuth first.",
    );
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
      connection.platform === "facebook" ||
      connection.platform === "instagram"
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
    const message =
      error instanceof Error ? error.message : "token_refresh_failed";
    const updated = await updateConnectionMetadata(
      connection,
      {
        lastTokenRefreshError: message,
        lastSyncError: message,
        lastTokenRefreshAttemptAt: new Date().toISOString(),
      },
      shouldRequireReconnect(message)
        ? "reconnect_required"
        : connection.status,
    );
    throw Object.assign(new Error(message), { connection: updated });
  }
}

export async function ensureSocialConnectionOperationalForOrg(
  orgId: string,
  connectionId: string,
) {
  const found = await getDb().query<SocialConnectionRecord>(
    "SELECT " +
      CONNECTION_SELECT +
      ' FROM "MigraMarketSocialConnection" WHERE id=$1 AND "orgId"=$2 LIMIT 1',
    [connectionId, orgId],
  );
  const connection = found.rows[0];
  if (!connection) throw new Error("Social connection not found.");

  let workingConnection = connection;
  let bundle = getCredentialBundle(workingConnection);
  let refreshedToken = false;
  let profileSynced = false;

  const refresh = await refreshConnectionAccessTokenIfNeeded(
    workingConnection,
  );
  workingConnection = refresh.connection;
  bundle = refresh.bundle;
  refreshedToken = refresh.refreshed;

  const health = assessSocialConnectionHealth(workingConnection);
  const needsProfileSync =
    refreshedToken ||
    health.recommendedAction === "sync" ||
    Boolean(readMetadataString(workingConnection.metadata, "lastSyncError"));

  if (needsProfileSync) {
    const synced = await syncLoadedSocialConnection(
      workingConnection,
      bundle,
    );
    workingConnection = synced.connection;
    bundle = synced.credentialBundle;
    profileSynced = true;
  }

  return {
    connection: workingConnection,
    refreshedToken,
    profileSynced,
  };
}

async function platformMaintenanceMode(): Promise<boolean> {
  const result = await getDb().query<{ maintenanceMode: boolean }>(
    'SELECT "maintenanceMode" FROM "PlatformConfig" WHERE id=$1 LIMIT 1',
    ["default"],
  );
  return Boolean(result.rows[0]?.maintenanceMode);
}

async function listCandidates(limit: number): Promise<SocialConnectionRecord[]> {
  const take = Math.min(Math.max(limit * 4, limit), 400);
  const result = await getDb().query<SocialConnectionRecord>(
    "SELECT " +
      CONNECTION_SELECT +
      ' FROM "MigraMarketSocialConnection" WHERE "accessModel"=$1 AND "credentialCiphertext" IS NOT NULL AND status<>$2 ORDER BY "tokenExpiresAt" ASC NULLS FIRST,"lastVerifiedAt" ASC NULLS FIRST,"updatedAt" ASC LIMIT $3',
    ["oauth", "paused", take],
  );
  return result.rows;
}

async function writeWorkerAudit(
  stats: SocialSyncStats,
  workerId: string | null,
): Promise<void> {
  await getDb().query(
    'INSERT INTO "AuditLog" (id,"userId","orgId",action,"entityType","entityId",metadata,"createdAt") VALUES ($1,NULL,NULL,$2,$3,$4,$5::jsonb,NOW())',
    [
      randomUUID(),
      "SOCIAL_CONNECTION_SYNC_WORKER_HEARTBEAT",
      "worker",
      "social-connection-sync",
      JSON.stringify({ ...stats, workerId }),
    ],
  );
}

export async function analyzeSocialConnectionSyncQueue(
  limit = socialConnectionSyncBatchSize(),
) {
  const candidates = await listCandidates(limit);
  return candidates.map((connection) => {
    const health = assessSocialConnectionHealth(connection);
    return {
      id: connection.id,
      orgId: connection.orgId,
      platform: connection.platform,
      status: connection.status,
      state: health.state,
      recommendedAction: health.recommendedAction,
      canAutoRefresh: health.canAutoRefresh,
      tokenExpired: health.tokenExpired,
      tokenExpiresSoon: health.tokenExpiresSoon,
      verificationStale: health.verificationStale,
      requiresReconnect: health.requiresReconnect,
      expiresInHours: health.expiresInHours,
      tokenExpiresAt: connection.tokenExpiresAt,
      lastVerifiedAt: connection.lastVerifiedAt,
    };
  });
}

export async function processSocialConnectionSyncQueue(
  limit = socialConnectionSyncBatchSize(),
  workerId: string | null = null,
): Promise<SocialSyncStats> {
  if (await platformMaintenanceMode()) {
    const paused: SocialSyncStats = {
      processed: 0,
      refreshed: 0,
      synced: 0,
      reconnectRequired: 0,
      failed: 0,
      skipped: 0,
      scanned: 0,
      paused: true,
    };
    await writeWorkerAudit(paused, workerId);
    return paused;
  }

  const candidates = await listCandidates(limit);
  const stats: SocialSyncStats = {
    processed: 0,
    refreshed: 0,
    synced: 0,
    reconnectRequired: 0,
    failed: 0,
    skipped: 0,
    scanned: candidates.length,
    paused: false,
  };

  for (const candidate of candidates) {
    if (stats.processed >= limit) break;
    const health = assessSocialConnectionHealth(candidate);

    if (health.recommendedAction === "monitor") {
      stats.skipped += 1;
      continue;
    }

    if (
      health.recommendedAction === "reconnect" ||
      health.recommendedAction === "connect"
    ) {
      if (
        health.recommendedAction === "reconnect" &&
        candidate.status !== "reconnect_required"
      ) {
        await updateConnection(candidate.id, {
          status: "reconnect_required",
        });
      }
      stats.reconnectRequired += 1;
      stats.skipped += 1;
      continue;
    }

    if (
      socialConnectionRetryBackoffActive(
        candidate,
        health.recommendedAction,
      )
    ) {
      stats.skipped += 1;
      continue;
    }

    try {
      const result = await ensureSocialConnectionOperationalForOrg(
        candidate.orgId,
        candidate.id,
      );
      stats.processed += 1;
      if (result.refreshedToken) stats.refreshed += 1;
      if (result.profileSynced) stats.synced += 1;
      if (assessSocialConnectionHealth(result.connection).requiresReconnect) {
        stats.reconnectRequired += 1;
      }
    } catch {
      stats.processed += 1;
      stats.failed += 1;
      const current = await getDb().query<SocialConnectionRecord>(
        "SELECT " +
          CONNECTION_SELECT +
          ' FROM "MigraMarketSocialConnection" WHERE id=$1 LIMIT 1',
        [candidate.id],
      );
      if (
        current.rows[0] &&
        assessSocialConnectionHealth(current.rows[0]).requiresReconnect
      ) {
        stats.reconnectRequired += 1;
      }
    }
  }

  await writeWorkerAudit(stats, workerId);
  return stats;
}
