import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/web") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

const workspace = repoFile(
  "apps/web/src/app/(platform)/platform/social/SocialConnectionsWorkspace.tsx",
);
const page = repoFile(
  "apps/web/src/app/(platform)/platform/social/page.tsx",
);
const listProxy = repoFile(
  "apps/web/src/app/api/platform/social/connections/route.ts",
);
const startProxy = repoFile(
  "apps/web/src/app/api/platform/social/connections/[connectionId]/oauth/start/route.ts",
);
const callback = repoFile(
  "apps/web/src/app/api/migramarket/social/connect/[platform]/callback/route.ts",
);
const sidebar = repoFile("apps/web/src/components/platform/PlatformSidebar.tsx");
const healthPanel = repoFile(
  "apps/web/src/components/platform/InfrastructureHealthPanel.tsx",
);

test("Social Connections is an authenticated Platform surface", () => {
  assert.match(page, /requirePermission\("platform\.read"\)/);
  assert.match(sidebar, /\/platform\/social/);
  assert.match(sidebar, /Social Connections/);
  assert.match(listProxy, /getAppSession/);
  assert.match(startProxy, /getAppSession/);
  assert.match(listProxy, /fetchPlatformAuthorityApi/);
  assert.match(startProxy, /fetchPlatformAuthorityApi/);
});

test("OAuth start remains explicit and callback preserves the registered legacy path", () => {
  assert.match(workspace, /\/oauth\/start/);
  assert.match(workspace, /window\.location\.assign/);
  assert.match(
    callback,
    /\/social\/connections\/oauth\/" \+ encodeURIComponent\(platform\) \+ "\/complete/,
  );
  assert.match(callback, /state/);
  assert.match(callback, /providerError/);
  assert.match(callback, /\/platform\/social/);
});

test("operator UI exposes truthful recovery classes without manual token input", () => {
  assert.match(workspace, /provider_setup/);
  assert.match(workspace, /integration_required/);
  assert.match(workspace, /google_business/);
  assert.match(workspace, /pinterest/);
  assert.match(workspace, /No manual-token recovery path/);
  assert.match(workspace, /platform\.social\.manage/);
  assert.doesNotMatch(workspace, /credentialCiphertext/);
  assert.doesNotMatch(workspace, /refreshTokenCiphertext/);
  assert.doesNotMatch(workspace, /accessToken/);
  assert.doesNotMatch(workspace, /refreshToken/);
});

test("Infrastructure Health separates reconnect, provider setup, and connector gaps", () => {
  assert.match(healthPanel, /socialProviderSetupRequired/);
  assert.match(healthPanel, /socialIntegrationRequired/);
  assert.match(healthPanel, /provider setup/);
  assert.match(healthPanel, /connector gap/);
  assert.match(healthPanel, /\/platform\/social/);
});

test("web proxies never implement provider token exchange locally", () => {
  const combined = listProxy + startProxy + callback;
  assert.doesNotMatch(combined, /client_secret/);
  assert.doesNotMatch(combined, /oauth2\.googleapis\.com/);
  assert.doesNotMatch(combined, /api\.x\.com/);
  assert.doesNotMatch(combined, /graph\.facebook\.com/);
});
