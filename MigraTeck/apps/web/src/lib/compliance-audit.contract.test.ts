import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function repoFile(path: string) {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/web") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

const auditProxy = repoFile(
  "apps/web/src/app/api/platform/compliance/audit/route.ts",
);
const exportRoute = repoFile(
  "apps/web/src/app/api/platform/compliance/audit/export/route.ts",
);
const workspace = repoFile(
  "apps/web/src/components/platform/ComplianceWorkspace.tsx",
);

test("platform compliance audit never silently scopes to the signed-in user", () => {
  assert.doesNotMatch(auditProxy, /session\.authUserId/);
  assert.match(auditProxy, /event_type/);
  assert.match(auditProxy, /user_id/);
  assert.match(auditProxy, /client_id/);
  assert.match(auditProxy, /platform audit authority is required/i);
});

test("audit filtering is server-side, not only a browser-page text search", () => {
  assert.match(workspace, /paramsFor\(filters, offset\)/);
  assert.match(workspace, /Apply filters/);
  assert.match(workspace, /Actor or target user UUID/);
  assert.match(workspace, /OAuth client ID/);
  assert.doesNotMatch(workspace, /Search current page/);
});

test("CSV evidence export is bounded and spreadsheet-formula safe", () => {
  assert.match(exportRoute, /const EXPORT_CAP = 2_000/);
  assert.match(exportRoute, /safeSpreadsheetValue/);
  assert.match(exportRoute, /\^\[=\+\\-@\]/);
  assert.match(exportRoute, /X-MigraTeck-Evidence-Truncated/);
});

test("compliance remains an evidence plane and hands mutations to owning controls", () => {
  assert.match(workspace, /Trust Operations/);
  assert.match(workspace, /Members & Access/);
  assert.match(workspace, /My Security/);
  assert.match(workspace, /Compliance preserves evidence/);
});
