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
  "apps/web/src/app/(platform)/platform/commerce/exceptions/page.tsx",
);
const workspace = repoFile(
  "apps/web/src/app/(platform)/platform/commerce/exceptions/RevenueExceptionsWorkspace.tsx",
);
const proxy = repoFile(
  "apps/web/src/app/api/platform/commerce/revenue-exceptions/route.ts",
);
const sidebar = repoFile(
  "apps/web/src/components/platform/PlatformSidebar.tsx",
);

test("revenue exceptions are platform-protected and visible in commerce navigation", () => {
  assert.match(page, /requirePermission\("platform\.read"\)/);
  assert.match(sidebar, /\/platform\/commerce\/exceptions/);
  assert.match(sidebar, /Revenue Exceptions/);
});

test("revenue exceptions browser surface is strictly read-only", () => {
  assert.match(workspace, /never performs payment, refund, invoice write-off/);
  assert.match(workspace, /\/api\/platform\/commerce\/revenue-exceptions\?/);
  assert.doesNotMatch(workspace, /method:\s*"POST"/);
  assert.doesNotMatch(workspace, /method:\s*"PATCH"/);
  assert.doesNotMatch(workspace, /method:\s*"PUT"/);
  assert.doesNotMatch(workspace, /method:\s*"DELETE"/);
});

test("revenue exceptions proxy preserves server-side filter authority", () => {
  for (const parameter of ["kind", "severity", "q", "limit", "offset"]) {
    assert.match(proxy, new RegExp(parameter));
  }
  assert.match(proxy, /getAppSession/);
  assert.match(proxy, /session\.permissions\.includes\("platform\.read"\)/);
  assert.match(proxy, /fetchPlatformAuthorityApi/);
  assert.match(proxy, /\/commerce\/revenue-exceptions/);
});

test("revenue exceptions has a truthful healthy-empty state", () => {
  assert.match(workspace, /No revenue exceptions detected/);
  assert.match(workspace, /This does not imply billing activity exists/);
  assert.match(
    workspace,
    /use\s+MigraPay & Billing to verify account and activity evidence/,
  );
});
