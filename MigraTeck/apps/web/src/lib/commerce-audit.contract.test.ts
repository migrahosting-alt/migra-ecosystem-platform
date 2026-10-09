import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/web") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

const page = repoFile(
  "apps/web/src/app/(platform)/platform/commerce/audit/page.tsx",
);
const workspace = repoFile(
  "apps/web/src/app/(platform)/platform/commerce/audit/CommerceAuditWorkspace.tsx",
);
const proxy = repoFile("apps/web/src/app/api/platform/commerce/audit/route.ts");
const sidebar = repoFile(
  "apps/web/src/components/platform/PlatformSidebar.tsx",
);

test("commerce audit page is platform-read protected and navigable", () => {
  assert.match(page, /requirePermission\("platform\.read"\)/);
  assert.match(sidebar, /\/platform\/commerce\/audit/);
  assert.match(sidebar, /Commerce Audit/);
  assert.match(sidebar, /item\.href === \"\/platform\/commerce\"/);
  assert.match(sidebar, /!exactOnly && pathname\.startsWith/);
});

test("commerce audit browser surface is strictly read-only", () => {
  assert.match(workspace, /Read-only evidence plane/);
  assert.match(workspace, /\/api\/platform\/commerce\/audit\?/);
  assert.doesNotMatch(workspace, /method:\s*"POST"/);
  assert.doesNotMatch(workspace, /method:\s*"PATCH"/);
  assert.doesNotMatch(workspace, /method:\s*"PUT"/);
  assert.doesNotMatch(workspace, /method:\s*"DELETE"/);
});

test("commerce audit uses server-side filters and bounded paging", () => {
  for (const parameter of [
    "family",
    "action",
    "orgId",
    "actorId",
    "q",
    "limit",
    "offset",
  ]) {
    assert.match(proxy, new RegExp(parameter));
  }
  assert.match(workspace, /Server-side filters/);
  assert.match(workspace, /limit: "50"/);
  assert.match(workspace, /setOffset/);
});

test("commerce audit proxy requires signed-in platform authority", () => {
  assert.match(proxy, /getAppSession/);
  assert.match(proxy, /session\.permissions\.includes\("platform\.read"\)/);
  assert.match(proxy, /fetchPlatformAuthorityApi/);
  assert.match(proxy, /"\/commerce\/audit" \+ suffix/);
});
