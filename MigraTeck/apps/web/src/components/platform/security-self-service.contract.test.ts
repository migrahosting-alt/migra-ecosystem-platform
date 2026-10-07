import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/web") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

const page = repoFile("apps/web/src/app/(platform)/platform/security/page.tsx");
const workspace = repoFile(
  "apps/web/src/components/platform/SecurityWorkspace.tsx",
);
const revokeOthers = repoFile(
  "apps/web/src/app/api/platform/security/sessions/revoke-others/route.ts",
);
const providers = repoFile(
  "apps/web/src/app/api/platform/security/providers/route.ts",
);
const unlinkProvider = repoFile(
  "apps/web/src/app/api/platform/security/providers/[provider]/route.ts",
);
const linkProvider = repoFile(
  "apps/web/src/app/api/platform/security/providers/[provider]/link/route.ts",
);
const password = repoFile(
  "apps/web/src/app/api/platform/security/password/route.ts",
);

test("Security is self-service identity control, not organization authority", () => {
  assert.match(page, /Trust \/ Your identity/);
  assert.match(page, /Security scope/);
  assert.match(page, /Your account/);
  assert.match(page, /href="\/platform\/trust"/);
  assert.doesNotMatch(page, /activeOrgRole/);
});

test("revoke-all-others preserves the current session through MigraAuth", () => {
  assert.match(revokeOthers, /"\/v1\/sessions\/others"/);
  assert.match(revokeOthers, /method:\s*"DELETE"/);
  assert.match(workspace, /Revoke all other sessions/);
  assert.match(workspace, /currentSession && remoteSessions\.length > 0/);
});

test("provider inventory combines configured and linked MigraAuth providers", () => {
  assert.match(providers, /"\/v1\/social\/providers"/);
  assert.match(providers, /"\/v1\/social\/links"/);
  assert.match(workspace, /Connected sign-in providers/);
  assert.match(workspace, /Last way in|last way in/i);
});

test("provider unlink stays behind the server-side last-sign-in-method guard", () => {
  assert.match(unlinkProvider, /"\/v1\/social\/" \+ encodeURIComponent\(slug\) \+ "\/link"/);
  assert.match(unlinkProvider, /method:\s*"DELETE"/);
  assert.match(workspace, /can_unlink_a_provider/);
});

test("provider linking is an authenticated MigraAuth link flow with public return origin", () => {
  assert.match(linkProvider, /mode=link&return_to=/);
  assert.match(linkProvider, /Authorization:\s*"Bearer " \+ token/);
  assert.match(linkProvider, /process\.env\.APP_BASE_URL/);
  assert.match(linkProvider, /redirect:\s*"manual"/);
});

test("signed-in password management clears the Platform session after MigraAuth succeeds", () => {
  assert.match(password, /"\/v1\/me\/password"/);
  assert.match(password, /new_password:\s*z\.string\(\)\.min\(10\)\.max\(128\)/);
  assert.match(password, /await clearAppSession\(\)/);
  assert.match(workspace, /Change password/);
  assert.match(workspace, /window\.location\.assign/);
});
