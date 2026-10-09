import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getManagedSocialOauthCapability } from "./social-connection-sync.js";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/api") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

const core = repoFile("apps/api/src/lib/social-connection-sync.ts");
const routes = repoFile("apps/api/src/routes/v1/modules/social-connections.ts");
const routeIndex = repoFile("apps/api/src/routes/v1/index.ts");

test("social operator routes have distinct read and manage authority", () => {
  assert.match(routes, /\/social\/connections/);
  assert.match(routes, /platform\.social\.read/);
  assert.match(routes, /platform\.social\.manage/);
  assert.match(routes, /\/social\/connections\/:connectionId\/oauth\/start/);
  assert.match(routes, /\/social\/connections\/oauth\/:platform\/complete/);
  assert.match(routeIndex, /registerSocialConnectionRoutes/);
});

test("operator inventory is secret-free and exposes truthful recovery classes", () => {
  const start = core.indexOf("export async function getSocialConnectionOperationsSnapshot");
  const end = core.indexOf("async function writeSocialOperatorAudit", start);
  assert.ok(start >= 0 && end > start);
  const snapshot = core.slice(start, end);
  assert.doesNotMatch(snapshot, /credentialCiphertext:/);
  assert.doesNotMatch(snapshot, /refreshTokenCiphertext:/);
  assert.doesNotMatch(snapshot, /lastSyncError:/);
  assert.match(core, /integration_required/);
  assert.match(core, /provider_setup/);
  assert.match(core, /reconnectRequired/);
  assert.match(core, /providerSetupRequired/);
  assert.match(core, /integrationRequired/);
});

test("managed OAuth preserves the legacy public callback path and uses encrypted state", () => {
  assert.match(core, /\/api\/migramarket\/social\/connect\//);
  assert.match(core, /\/callback/);
  assert.match(core, /encodeSocialOauthState/);
  assert.match(core, /decryptSocialSecret/);
  assert.match(core, /socialOauthCodeChallenge/);
  assert.match(core, /code_challenge_method/);
  assert.match(core, /10 \* 60 \* 1000/);
});

test("supported OAuth providers are explicit and unsupported placeholders stay unsupported", () => {
  for (const platform of [
    "facebook",
    "instagram",
    "linkedin",
    "youtube",
    "x",
    "tiktok",
  ]) {
    assert.equal(getManagedSocialOauthCapability(platform).supported, true, platform);
  }
  assert.equal(getManagedSocialOauthCapability("google_business").supported, false);
  assert.equal(getManagedSocialOauthCapability("pinterest").supported, false);
});

test("OAuth completion never returns raw provider tokens", () => {
  const start = core.indexOf("export async function completeSocialConnectionOAuth");
  const end = core.indexOf("async function platformMaintenanceMode", start);
  assert.ok(start >= 0 && end > start);
  const completion = core.slice(start, end);
  assert.doesNotMatch(completion, /return\s*\{[^}]*accessToken/s);
  assert.doesNotMatch(completion, /return\s*\{[^}]*refreshToken/s);
  assert.match(completion, /encryptCredentialBundle/);
  assert.match(completion, /encryptSocialSecret/);
  assert.match(completion, /SOCIAL_CONNECTION_OAUTH_CONNECTED/);
});


test("managed OAuth state is single-use and superseded starts fail closed", () => {
  assert.match(core, /armSocialOauthState/);
  assert.match(core, /claimSocialOauthState/);
  assert.match(core, /oauthStateNonceHash/);
  assert.match(core, /oauthStateExpiresAt/);
  assert.match(core, /oauthStateActorId/);
  assert.match(core, /socialOauthStateNonceHash/);
  assert.match(core, /already used, superseded, or is no longer valid/);
  assert.match(core, /await claimSocialOauthState\(state\)/);
});

test("multi-account providers never fall back to the first available identity", () => {
  assert.match(core, /candidates\.length === 1 \? candidates\[0\]/);
  assert.match(core, /Multiple Facebook pages are available/);
  assert.match(core, /Multiple Instagram business accounts are available/);
  assert.match(core, /Multiple YouTube channels are available/);
  assert.doesNotMatch(core, /return candidates\[0\] \|\| null/);
});
