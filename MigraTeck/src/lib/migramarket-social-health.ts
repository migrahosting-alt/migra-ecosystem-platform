import {
  socialConnectionSyncRefreshWindowHours,
  socialConnectionVerificationStaleHours,
} from "@/lib/env";

type SocialConnectionHealthInput = {
  platform: string;
  accessModel?: string | null;
  status?: string | null;
  externalAccountId?: string | null;
  metadata?: unknown;
  tokenExpiresAt?: Date | null;
  credentialCiphertext?: string | null;
  lastVerifiedAt?: Date | null;
};

export type SocialConnectionHealthState =
  | "healthy"
  | "disconnected"
  | "reconnect_required"
  | "token_expiring"
  | "verification_stale";

export type SocialConnectionRecommendedAction = "connect" | "reconnect" | "refresh" | "sync" | "monitor";

const refreshablePlatforms = new Set(["facebook", "instagram", "linkedin", "youtube", "x", "tiktok"]);

function parseMetadata(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  return metadata as Record<string, unknown>;
}

function readString(metadata: unknown, key: string): string | null {
  const value = parseMetadata(metadata)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiresReconnectFromMessage(message: string | null): boolean {
  if (!message) {
    return false;
  }

  return /reconnect|invalid[_\s-]?grant|invalid[_\s-]?token|expired|revoked|unauthoriz|authorization|oauth/i.test(message);
}

export function canAutoRefreshSocialConnection(platform: string): boolean {
  return refreshablePlatforms.has(platform.trim().toLowerCase());
}

export function assessSocialConnectionHealth(connection: SocialConnectionHealthInput, now = new Date()) {
  const connected = Boolean(connection.credentialCiphertext);
  const oauthManaged = (connection.accessModel || "").trim().toLowerCase() === "oauth";
  const canAutoRefresh = oauthManaged && connected && canAutoRefreshSocialConnection(connection.platform);
  const refreshWindowMs = socialConnectionSyncRefreshWindowHours * 60 * 60 * 1000;
  const verificationWindowMs = socialConnectionVerificationStaleHours * 60 * 60 * 1000;
  const tokenExpiresAt = connection.tokenExpiresAt || null;
  const lastVerifiedAt = connection.lastVerifiedAt || null;
  const lastSyncError = readString(connection.metadata, "lastSyncError");
  const tokenExpired = Boolean(tokenExpiresAt && tokenExpiresAt.getTime() <= now.getTime());
  const tokenExpiresSoon = Boolean(
    tokenExpiresAt && tokenExpiresAt.getTime() > now.getTime() && tokenExpiresAt.getTime() - now.getTime() <= refreshWindowMs,
  );
  const verificationStale = Boolean(
    connected && (!lastVerifiedAt || now.getTime() - lastVerifiedAt.getTime() >= verificationWindowMs),
  );
  const missingAccountBinding = connected && !connection.externalAccountId;
  const statusRequiresReconnect = (connection.status || "").trim().toLowerCase() === "reconnect_required";
  const requiresReconnect =
    statusRequiresReconnect ||
    requiresReconnectFromMessage(lastSyncError) ||
    (oauthManaged && connected && tokenExpired && !canAutoRefresh);

  let state: SocialConnectionHealthState = "healthy";
  let recommendedAction: SocialConnectionRecommendedAction = "monitor";
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
    (connection.status || "").trim().toLowerCase() !== "ready"
  ) {
    state = "verification_stale";
    recommendedAction = "sync";
    summary = missingAccountBinding ? "Account binding needs sync" : "Verification sync overdue";
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
        ? Math.round(((tokenExpiresAt.getTime() - now.getTime()) / (60 * 60 * 1000)) * 10) / 10
        : null,
  };
}
