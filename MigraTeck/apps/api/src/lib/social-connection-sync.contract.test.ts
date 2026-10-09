import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assessSocialConnectionHealth,
  socialConnectionRetryBackoffActive,
} from "./social-connection-sync.js";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/api") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

const core = repoFile("apps/api/src/lib/social-connection-sync.ts");
const worker = repoFile("apps/api/src/social-connection-sync-worker.ts");

test("managed social sync preserves encrypted OAuth credential handling", () => {
  assert.ok(core.includes("aes-256-gcm"));
  assert.ok(core.includes("MIGRAMARKET_SOCIAL_CONNECT_ENCRYPTION_KEY"));
  assert.ok(core.includes("LAUNCH_TOKEN_SECRET"));
  assert.ok(core.includes("Invalid encrypted social secret payload"));
  assert.ok(core.includes("encryptCredentialBundle"));
  assert.ok(core.includes("refreshTokenCiphertext"));
});

test("candidate selection remains oauth-only, credentialed, and excludes paused connections", () => {
  assert.ok(core.includes('"accessModel"=$1'));
  assert.ok(core.includes('"credentialCiphertext" IS NOT NULL'));
  assert.ok(core.includes("status<>$2"));
  assert.ok(core.includes('["oauth", "paused", take]'));
});

test("health policy retains refresh, sync, reconnect, and stale verification semantics", () => {
  assert.ok(core.includes("SOCIAL_CONNECTION_SYNC_REFRESH_WINDOW_HOURS"));
  assert.ok(core.includes("SOCIAL_CONNECTION_SYNC_VERIFICATION_STALE_HOURS"));
  assert.ok(core.includes("token_expiring"));
  assert.ok(core.includes("verification_stale"));
  assert.ok(core.includes("reconnect_required"));
  assert.ok(core.includes("recommendedAction"));
});

test("provider refresh paths use configured OAuth clients and rotate encrypted tokens", () => {
  for (const marker of [
    "MIGRAMARKET_META_CLIENT_ID",
    "MIGRAMARKET_META_CLIENT_SECRET",
    "MIGRAMARKET_X_CLIENT_ID",
    "MIGRAMARKET_X_CLIENT_SECRET",
    "MIGRAMARKET_LINKEDIN_CLIENT_ID",
    "MIGRAMARKET_LINKEDIN_CLIENT_SECRET",
    "MIGRAMARKET_GOOGLE_CLIENT_ID",
    "MIGRAMARKET_GOOGLE_CLIENT_SECRET",
    "MIGRAMARKET_TIKTOK_CLIENT_KEY",
    "MIGRAMARKET_TIKTOK_CLIENT_SECRET",
    "oauth2.googleapis.com/token",
    "open.tiktokapis.com/v2/oauth/token",
    "linkedin.com/oauth/v2/accessToken",
    "oauth/access_token",
  ]) {
    assert.ok(core.includes(marker), marker);
  }
});

test("profile sync supports all API-managed production social providers", () => {
  for (const marker of [
    "syncFacebookConnection",
    "syncInstagramConnection",
    "syncLinkedInConnection",
    "syncYouTubeConnection",
    "syncXConnection",
    "syncTikTokConnection",
  ]) {
    assert.ok(core.includes(marker), marker);
  }
});

test("worker honors maintenance mode and emits bounded audit heartbeat statistics", () => {
  assert.ok(core.includes("maintenanceMode"));
  assert.ok(core.includes("SOCIAL_CONNECTION_SYNC_WORKER_HEARTBEAT"));
  assert.ok(core.includes("processed"));
  assert.ok(core.includes("refreshed"));
  assert.ok(core.includes("synced"));
  assert.ok(core.includes("reconnectRequired"));
  assert.ok(core.includes("failed"));
});

test("analyzer exposes health metadata without returning credential ciphertext", () => {
  assert.ok(core.includes("analyzeSocialConnectionSyncQueue"));
  const analyzer = core.slice(
    core.indexOf("export async function analyzeSocialConnectionSyncQueue"),
    core.indexOf("export async function processSocialConnectionSyncQueue"),
  );
  assert.ok(!analyzer.includes("credentialCiphertext:"));
  assert.ok(!analyzer.includes("refreshTokenCiphertext:"));
  assert.ok(analyzer.includes("recommendedAction"));
  assert.ok(analyzer.includes("providerSetupRequired"));
});



test("operator inspection includes disconnected OAuth rows and returns only redacted health evidence", () => {
  assert.ok(core.includes("inspectSocialConnectionHealth"));
  const inspector = core.slice(
    core.indexOf("export async function inspectSocialConnectionHealth"),
    core.indexOf("async function writeWorkerAudit"),
  );
  assert.match(inspector, /listInspectableConnections/);
  assert.match(inspector, /orgName/);
  assert.match(inspector, /connected: health\.connected/);
  assert.match(inspector, /providerSetupRequired: health\.providerSetupRequired/);
  assert.match(inspector, /recommendedAction: health\.recommendedAction/);
  assert.doesNotMatch(inspector, /credentialCiphertext:/);
  assert.doesNotMatch(inspector, /refreshTokenCiphertext:/);
  assert.doesNotMatch(inspector, /externalAccountId:/);
});

test("managed worker has heartbeat and graceful shutdown", () => {
  assert.ok(worker.includes("migrateck-social-sync/heartbeat.json"));
  assert.ok(worker.includes("SIGTERM"));
  assert.ok(worker.includes("SIGINT"));
  assert.ok(worker.includes("await closeDb()"));
  assert.ok(worker.includes("SOCIAL_CONNECTION_SYNC_INTERVAL_MS"));
});


test("invalid token wording is terminal even when token and invalid are separated", () => {
  const health = assessSocialConnectionHealth(
    {
      platform: "x",
      accessModel: "oauth",
      status: "ready",
      externalAccountId: "123",
      metadata: {
        lastSyncError: "Value passed for the token was invalid.",
      },
      tokenExpiresAt: null,
      credentialCiphertext: "encrypted-placeholder",
      lastVerifiedAt: new Date("2026-10-08T09:00:00Z"),
    },
    new Date("2026-10-08T09:15:00Z"),
  );

  assert.equal(health.requiresReconnect, true);
  assert.equal(health.state, "reconnect_required");
  assert.equal(health.recommendedAction, "reconnect");
});

test("Meta connections without a publishable Page or business account require provider setup", () => {
  for (const [platform, message] of [
    ["facebook", "No Facebook pages were found for this Meta connection."],
    ["instagram", "No Instagram business account was found for this Meta connection."],
  ] as const) {
    const health = assessSocialConnectionHealth(
      {
        platform,
        accessModel: "oauth",
        status: "ready",
        externalAccountId: "meta-account",
        metadata: { lastSyncError: message },
        tokenExpiresAt: null,
        credentialCiphertext: "encrypted-placeholder",
        lastVerifiedAt: new Date("2026-10-08T21:25:00Z"),
      },
      new Date("2026-10-08T21:30:00Z"),
    );

    assert.equal(health.providerSetupRequired, true, platform);
    assert.equal(health.requiresReconnect, true, platform);
    assert.equal(health.state, "reconnect_required", platform);
    assert.equal(health.recommendedAction, "reconnect", platform);
    assert.equal(health.summary, "Provider account setup required", platform);
  }
});

test("provider refresh windows avoid refreshing short-lived tokens too early", () => {
  const previous = process.env.SOCIAL_CONNECTION_SYNC_REFRESH_WINDOW_HOURS;
  process.env.SOCIAL_CONNECTION_SYNC_REFRESH_WINDOW_HOURS = "72";

  try {
    const now = new Date("2026-10-08T21:00:00Z");
    const base = {
      platform: "youtube",
      accessModel: "oauth",
      status: "ready",
      externalAccountId: "channel",
      metadata: {},
      credentialCiphertext: "encrypted-placeholder",
      lastVerifiedAt: now,
    };

    const twentyMinutes = assessSocialConnectionHealth(
      {
        ...base,
        tokenExpiresAt: new Date(now.getTime() + 20 * 60 * 1000),
      },
      now,
    );
    assert.equal(twentyMinutes.state, "healthy");

    const tenMinutes = assessSocialConnectionHealth(
      {
        ...base,
        tokenExpiresAt: new Date(now.getTime() + 10 * 60 * 1000),
      },
      now,
    );
    assert.equal(tenMinutes.state, "token_expiring");
    assert.equal(tenMinutes.recommendedAction, "refresh");
  } finally {
    if (previous === undefined) {
      delete process.env.SOCIAL_CONNECTION_SYNC_REFRESH_WINDOW_HOURS;
    } else {
      process.env.SOCIAL_CONNECTION_SYNC_REFRESH_WINDOW_HOURS = previous;
    }
  }
});

test("OAuth provider errors preserve string error codes and descriptions", () => {
  assert.match(core, /typeof body\.error === "string"/);
  assert.match(core, /errorCode \+ ": " \+ errorDescription/);
  assert.match(core, /structuredMessage/);
});

test("sync and refresh failures honor the configured retry backoff window", () => {
  const previous = process.env.SOCIAL_CONNECTION_SYNC_ERROR_RETRY_MINUTES;
  process.env.SOCIAL_CONNECTION_SYNC_ERROR_RETRY_MINUTES = "60";

  try {
    const syncConnection = {
      metadata: {
        lastSyncAttemptAt: "2026-10-08T09:00:00.000Z",
      },
    };
    assert.equal(
      socialConnectionRetryBackoffActive(
        syncConnection,
        "sync",
        new Date("2026-10-08T09:59:59.000Z"),
      ),
      true,
    );
    assert.equal(
      socialConnectionRetryBackoffActive(
        syncConnection,
        "sync",
        new Date("2026-10-08T10:00:01.000Z"),
      ),
      false,
    );

    const refreshConnection = {
      metadata: {
        lastTokenRefreshAttemptAt: "2026-10-08T09:30:00.000Z",
      },
    };
    assert.equal(
      socialConnectionRetryBackoffActive(
        refreshConnection,
        "refresh",
        new Date("2026-10-08T10:00:00.000Z"),
      ),
      true,
    );
    assert.equal(
      socialConnectionRetryBackoffActive(
        refreshConnection,
        "reconnect",
        new Date("2026-10-08T10:00:00.000Z"),
      ),
      false,
    );
  } finally {
    if (previous === undefined) {
      delete process.env.SOCIAL_CONNECTION_SYNC_ERROR_RETRY_MINUTES;
    } else {
      process.env.SOCIAL_CONNECTION_SYNC_ERROR_RETRY_MINUTES = previous;
    }
  }
});

test("worker skips reconnect-only connections and persists terminal state before provider calls", () => {
  assert.match(
    core,
    /health\.recommendedAction === "reconnect"[\s\S]*?candidate\.status !== "reconnect_required"[\s\S]*?status: "reconnect_required"/,
  );
  assert.match(core, /socialConnectionRetryBackoffActive/);
  assert.match(core, /lastSyncAttemptAt/);
  assert.match(core, /lastTokenRefreshAttemptAt/);
});
