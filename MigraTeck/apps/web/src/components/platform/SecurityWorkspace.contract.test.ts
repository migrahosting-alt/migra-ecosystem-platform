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
  "apps/web/src/components/platform/SecurityWorkspace.tsx",
);
const statusProxy = repoFile(
  "apps/web/src/app/api/platform/security/status/route.ts",
);
const disableProxy = repoFile(
  "apps/web/src/app/api/platform/security/mfa/disable/route.ts",
);
const recoveryProxy = repoFile(
  "apps/web/src/app/api/platform/security/mfa/recovery-codes/route.ts",
);

test("security posture comes from MigraAuth instead of local MFA assumptions", () => {
  assert.match(statusProxy, /"\/v1\/me\/security"/);
  assert.match(workspace, /fetch\("\/api\/platform\/security\/status"/);
  assert.match(workspace, /securityPosture\?\.mfa_enabled/);
  assert.match(workspace, /recovery_codes_stale/);
  assert.match(workspace, /has_password/);
  assert.match(workspace, /sign_in_methods/);
  assert.match(workspace, /linked_providers/);
});

test("MFA enrollment is not offered until authoritative posture is loaded", () => {
  assert.match(
    workspace,
    /mfaStep === "idle" && !postureLoading && securityPosture\?\.mfa_enabled === false/,
  );
});

test("MFA disable accepts the proof types MigraAuth supports", () => {
  assert.match(disableProxy, /password: z\.string\(\).*\.optional\(\)/s);
  assert.match(disableProxy, /code: z\.string\(\).*\.optional\(\)/s);
  assert.match(disableProxy, /body\.password \?\? body\.code/);
  assert.match(workspace, /Authenticator or recovery code/);
  assert.match(workspace, /disableCode/);
});

test("recovery codes can be replaced without disabling MFA", () => {
  assert.match(recoveryProxy, /"\/v1\/mfa\/recovery-codes"/);
  assert.match(workspace, /Replace codes/);
  assert.match(workspace, /replacementRecoveryCodes/);
  assert.match(workspace, /This is the only time this replacement set can be displayed/);
  assert.match(workspace, /loadSecurityPosture\(\)/);
});

test("recovery email is blocked when MigraAuth reports an unverified email", () => {
  assert.match(
    workspace,
    /resetPending \|\| securityPosture\?\.email_verified === false/,
  );
  assert.match(workspace, /Verify the account email before using email-based password recovery/);
});
