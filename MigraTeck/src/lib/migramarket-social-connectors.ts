import { createHash, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

export type SocialOauthPlatform = "facebook" | "instagram" | "linkedin" | "youtube" | "x" | "tiktok";

type ProviderProfile = {
  externalAccountId: string;
  handle: string;
  profileUrl: string | null;
  metadata: Record<string, unknown>;
};

type TokenSet = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt: Date | null;
  scopes: string[];
  raw: Record<string, unknown>;
};

type ProviderConfig = {
  platform: SocialOauthPlatform;
  label: string;
  authEndpoint: string;
  tokenEndpoint: string;
  scopes: string[];
  scopeDelimiter?: "space" | "comma";
  clientId: string | undefined;
  clientSecret: string | undefined;
  clientIdParamName?: "client_id" | "client_key";
  usesPkce?: boolean;
  extraAuthParams?: Record<string, string>;
  buildProfileRequest: (accessToken: string) => { url: string; init?: RequestInit };
  parseTokenResponse: (data: Record<string, unknown>) => TokenSet;
  parseProfileResponse: (data: Record<string, unknown>, tokenSet: TokenSet) => ProviderProfile;
};

export type SocialOauthSessionState = {
  nonce: string;
  platform: SocialOauthPlatform;
  orgId: string;
  actorUserId: string;
  connectionId: string | null;
  codeVerifier: string | null;
  createdAt: string;
};

function fallbackHandle(prefix: string, externalAccountId: string) {
  return `${prefix}-${externalAccountId.slice(-6)}`.toLowerCase();
}

function normalizeHandle(value: string, fallback: string) {
  const normalized = value.trim();
  return normalized || fallback;
}

function toExpiresAt(value: unknown): Date | null {
  const seconds = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  return new Date(Date.now() + seconds * 1000);
}

function splitScopes(value: unknown, delimiter: "space" | "comma" = "space") {
  if (typeof value !== "string") {
    return [];
  }

  const separator = delimiter === "comma" ? "," : " ";
  return value
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);
}

const providerConfigs: Record<SocialOauthPlatform, ProviderConfig> = {
  facebook: {
    platform: "facebook",
    label: "Facebook",
    authEndpoint: "https://www.facebook.com/v23.0/dialog/oauth",
    tokenEndpoint: "https://graph.facebook.com/v23.0/oauth/access_token",
    scopes: ["pages_show_list", "pages_manage_posts", "pages_read_engagement", "public_profile"],
    clientId: env.MIGRAMARKET_META_CLIENT_ID,
    clientSecret: env.MIGRAMARKET_META_CLIENT_SECRET,
    extraAuthParams: { auth_type: "rerequest" },
    buildProfileRequest: (accessToken) => ({
      url: "https://graph.facebook.com/v23.0/me?fields=id,name",
      init: { headers: { Authorization: `Bearer ${accessToken}` } },
    }),
    parseTokenResponse: (data) => ({
      accessToken: String(data.access_token || ""),
      refreshToken: null,
      expiresAt: toExpiresAt(data.expires_in),
      scopes: splitScopes(data.scope),
      raw: data,
    }),
    parseProfileResponse: (data) => {
      const id = String(data.id || "");
      const name = String(data.name || "");
      return {
        externalAccountId: id,
        handle: normalizeHandle(name, fallbackHandle("facebook", id)),
        profileUrl: null,
        metadata: { displayName: name || null },
      };
    },
  },
  instagram: {
    platform: "instagram",
    label: "Instagram",
    authEndpoint: "https://www.facebook.com/v23.0/dialog/oauth",
    tokenEndpoint: "https://graph.facebook.com/v23.0/oauth/access_token",
    scopes: ["pages_show_list", "instagram_basic", "instagram_content_publish", "pages_read_engagement"],
    clientId: env.MIGRAMARKET_META_CLIENT_ID,
    clientSecret: env.MIGRAMARKET_META_CLIENT_SECRET,
    extraAuthParams: { auth_type: "rerequest" },
    buildProfileRequest: (accessToken) => ({
      url: "https://graph.facebook.com/v23.0/me?fields=id,name",
      init: { headers: { Authorization: `Bearer ${accessToken}` } },
    }),
    parseTokenResponse: (data) => ({
      accessToken: String(data.access_token || ""),
      refreshToken: null,
      expiresAt: toExpiresAt(data.expires_in),
      scopes: splitScopes(data.scope),
      raw: data,
    }),
    parseProfileResponse: (data) => {
      const id = String(data.id || "");
      const name = String(data.name || "");
      return {
        externalAccountId: id,
        handle: normalizeHandle(name, fallbackHandle("instagram", id)),
        profileUrl: null,
        metadata: { displayName: name || null },
      };
    },
  },
  linkedin: {
    platform: "linkedin",
    label: "LinkedIn",
    authEndpoint: "https://www.linkedin.com/oauth/v2/authorization",
    tokenEndpoint: "https://www.linkedin.com/oauth/v2/accessToken",
    scopes: ["openid", "profile", "w_member_social"],
    clientId: env.MIGRAMARKET_LINKEDIN_CLIENT_ID,
    clientSecret: env.MIGRAMARKET_LINKEDIN_CLIENT_SECRET,
    buildProfileRequest: (accessToken) => ({
      url: "https://api.linkedin.com/v2/userinfo",
      init: { headers: { Authorization: `Bearer ${accessToken}` } },
    }),
    parseTokenResponse: (data) => ({
      accessToken: String(data.access_token || ""),
      refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
      expiresAt: toExpiresAt(data.expires_in),
      scopes: splitScopes(data.scope),
      raw: data,
    }),
    parseProfileResponse: (data) => {
      const sub = String(data.sub || "");
      const name = String(data.name || data.given_name || "");
      const picture = typeof data.picture === "string" ? data.picture : null;
      const email = typeof data.email === "string" ? data.email : null;
      return {
        externalAccountId: sub,
        handle: normalizeHandle(name || email || "", fallbackHandle("linkedin", sub)),
        profileUrl: null,
        metadata: { displayName: name || email, avatarUrl: picture, email },
      };
    },
  },
  youtube: {
    platform: "youtube",
    label: "YouTube",
    authEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    scopes: ["openid", "email", "profile", "https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"],
    clientId: env.MIGRAMARKET_GOOGLE_CLIENT_ID,
    clientSecret: env.MIGRAMARKET_GOOGLE_CLIENT_SECRET,
    extraAuthParams: { access_type: "offline", include_granted_scopes: "true", prompt: "consent" },
    buildProfileRequest: (accessToken) => ({
      url: "https://www.googleapis.com/oauth2/v3/userinfo",
      init: { headers: { Authorization: `Bearer ${accessToken}` } },
    }),
    parseTokenResponse: (data) => ({
      accessToken: String(data.access_token || ""),
      refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
      expiresAt: toExpiresAt(data.expires_in),
      scopes: splitScopes(data.scope),
      raw: data,
    }),
    parseProfileResponse: (data) => {
      const sub = String(data.sub || "");
      const name = String(data.name || "");
      const picture = typeof data.picture === "string" ? data.picture : null;
      const email = typeof data.email === "string" ? data.email : null;
      return {
        externalAccountId: sub,
        handle: normalizeHandle(name || email || "", fallbackHandle("youtube", sub)),
        profileUrl: null,
        metadata: { displayName: name || email, avatarUrl: picture, email },
      };
    },
  },
  x: {
    platform: "x",
    label: "X",
    authEndpoint: "https://x.com/i/oauth2/authorize",
    tokenEndpoint: "https://api.x.com/2/oauth2/token",
    scopes: ["tweet.read", "tweet.write", "users.read", "media.write", "offline.access"],
    clientId: env.MIGRAMARKET_X_CLIENT_ID,
    clientSecret: env.MIGRAMARKET_X_CLIENT_SECRET,
    usesPkce: true,
    buildProfileRequest: (accessToken) => ({
      url: "https://api.x.com/2/users/me?user.fields=profile_image_url,username,name",
      init: { headers: { Authorization: `Bearer ${accessToken}` } },
    }),
    parseTokenResponse: (data) => ({
      accessToken: String(data.access_token || ""),
      refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
      expiresAt: toExpiresAt(data.expires_in),
      scopes: splitScopes(data.scope),
      raw: data,
    }),
    parseProfileResponse: (data) => {
      const record = (data.data && typeof data.data === "object" && !Array.isArray(data.data) ? data.data : {}) as Record<string, unknown>;
      const id = String(record.id || "");
      const username = typeof record.username === "string" ? record.username : "";
      const name = typeof record.name === "string" ? record.name : "";
      const avatarUrl = typeof record.profile_image_url === "string" ? record.profile_image_url : null;
      return {
        externalAccountId: id,
        handle: normalizeHandle(username ? `@${username}` : name, fallbackHandle("x", id)),
        profileUrl: username ? `https://x.com/${username}` : null,
        metadata: { displayName: name || username, avatarUrl, username: username || null },
      };
    },
  },
  tiktok: {
    platform: "tiktok",
    label: "TikTok",
    authEndpoint: "https://www.tiktok.com/v2/auth/authorize/",
    tokenEndpoint: "https://open.tiktokapis.com/v2/oauth/token/",
    scopes: ["user.info.basic", "video.publish"],
    scopeDelimiter: "comma",
    clientIdParamName: "client_key",
    clientId: env.MIGRAMARKET_TIKTOK_CLIENT_KEY,
    clientSecret: env.MIGRAMARKET_TIKTOK_CLIENT_SECRET,
    buildProfileRequest: (accessToken) => ({
      url: "https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,display_name,avatar_url,username,profile_deep_link",
      init: { headers: { Authorization: `Bearer ${accessToken}` } },
    }),
    parseTokenResponse: (data) => ({
      accessToken: String(data.access_token || ""),
      refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
      expiresAt: toExpiresAt(data.expires_in),
      scopes: splitScopes(data.scope, "comma"),
      raw: data,
    }),
    parseProfileResponse: (data, tokenSet) => {
      const root = (data.data && typeof data.data === "object" && !Array.isArray(data.data) ? data.data : {}) as Record<string, unknown>;
      const user = (root.user && typeof root.user === "object" && !Array.isArray(root.user) ? root.user : {}) as Record<string, unknown>;
      const openId = String(user.open_id || (tokenSet.raw.open_id as string) || "");
      const username = typeof user.username === "string" ? user.username : "";
      const displayName = typeof user.display_name === "string" ? user.display_name : "";
      const avatarUrl = typeof user.avatar_url === "string" ? user.avatar_url : null;
      const profileDeepLink = typeof user.profile_deep_link === "string" ? user.profile_deep_link : null;
      return {
        externalAccountId: openId,
        handle: normalizeHandle(username ? `@${username}` : displayName, fallbackHandle("tiktok", openId)),
        profileUrl: profileDeepLink,
        metadata: { displayName: displayName || username, avatarUrl, username: username || null },
      };
    },
  },
};

export function getSocialOauthProvider(platform: string): ProviderConfig | null {
  const normalized = platform.trim().toLowerCase() as SocialOauthPlatform;
  return providerConfigs[normalized] || null;
}

export function isSocialOauthSupported(platform: string): boolean {
  return Boolean(getSocialOauthProvider(platform));
}

export function isSocialOauthConfigured(platform: string): boolean {
  const provider = getSocialOauthProvider(platform);
  return Boolean(provider?.clientId && provider?.clientSecret);
}

export function getSocialOauthBaseUrl(): string {
  return env.NEXTAUTH_URL || process.env.BASE_URL || "http://localhost:3000";
}

export function getSocialOauthRedirectUri(platform: SocialOauthPlatform): string {
  return `${getSocialOauthBaseUrl()}/api/migramarket/social/connect/${platform}/callback`;
}

export function getSocialOauthCookieName(platform: string): string {
  return `migramarket_social_oauth_${platform.trim().toLowerCase()}`;
}

export function createCodeVerifier() {
  return randomBytes(32).toString("base64url");
}

export function createCodeChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function createSocialOauthNonce() {
  return randomBytes(18).toString("base64url");
}

export function buildSocialOauthAuthorizeUrl(platform: SocialOauthPlatform, state: SocialOauthSessionState) {
  const provider = getSocialOauthProvider(platform);
  if (!provider) {
    throw new Error("OAuth provider not supported.");
  }

  if (!provider.clientId || !provider.clientSecret) {
    throw new Error(`${provider.label} OAuth is not configured yet.`);
  }

  const params = new URLSearchParams();
  params.set(provider.clientIdParamName || "client_id", provider.clientId);
  params.set("redirect_uri", getSocialOauthRedirectUri(platform));
  params.set("response_type", "code");
  params.set("scope", provider.scopes.join(provider.scopeDelimiter === "comma" ? "," : " "));
  params.set("state", state.nonce);

  if (provider.usesPkce && state.codeVerifier) {
    params.set("code_challenge", createCodeChallenge(state.codeVerifier));
    params.set("code_challenge_method", "S256");
  }

  for (const [key, value] of Object.entries(provider.extraAuthParams || {})) {
    params.set(key, value);
  }

  return `${provider.authEndpoint}?${params.toString()}`;
}

export async function exchangeSocialOauthCode(platform: SocialOauthPlatform, code: string, codeVerifier: string | null) {
  const provider = getSocialOauthProvider(platform);
  if (!provider?.clientId || !provider.clientSecret) {
    throw new Error("OAuth provider is not configured.");
  }

  const body = new URLSearchParams();
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  // X OAuth 2.0 confidential clients expect HTTP Basic auth on token exchange.
  if (provider.platform === "x") {
    const basicAuth = Buffer.from(`${provider.clientId}:${provider.clientSecret}`).toString("base64");
    headers.Authorization = `Basic ${basicAuth}`;
  } else {
    body.set(provider.clientIdParamName || "client_id", provider.clientId);
    body.set("client_secret", provider.clientSecret);
  }

  body.set("code", code);
  body.set("grant_type", "authorization_code");
  body.set("redirect_uri", getSocialOauthRedirectUri(platform));

  if (provider.usesPkce && codeVerifier) {
    body.set("code_verifier", codeVerifier);
  }

  const response = await fetch(provider.tokenEndpoint, {
    method: "POST",
    headers,
    body,
    cache: "no-store",
  });

  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !data) {
    const description =
      (data && typeof data.error_description === "string" && data.error_description) ||
      (data && typeof data.message === "string" && data.message) ||
      "OAuth token exchange failed.";
    throw new Error(description);
  }

  const tokenSet = provider.parseTokenResponse(data);
  if (!tokenSet.accessToken) {
    throw new Error("OAuth token response did not include an access token.");
  }

  return tokenSet;
}

export async function fetchSocialOauthProfile(platform: SocialOauthPlatform, tokenSet: TokenSet) {
  const provider = getSocialOauthProvider(platform);
  if (!provider) {
    throw new Error("OAuth provider not supported.");
  }

  const request = provider.buildProfileRequest(tokenSet.accessToken);
  const response = await fetch(request.url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...(request.init?.headers || {}),
    },
    cache: "no-store",
  });
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !data) {
    throw new Error("Unable to fetch connected profile.");
  }

  const profile = provider.parseProfileResponse(data, tokenSet);
  if (!profile.externalAccountId || !profile.handle) {
    throw new Error("Connected profile response was incomplete.");
  }

  return profile;
}

export function getSocialOauthCapabilities(platform: string) {
  const provider = getSocialOauthProvider(platform);
  return {
    supported: Boolean(provider),
    configured: Boolean(provider?.clientId && provider?.clientSecret),
    usesPkce: Boolean(provider?.usesPkce),
    label: provider?.label || null,
  };
}
