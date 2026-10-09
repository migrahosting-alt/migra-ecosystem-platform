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
  "apps/web/src/app/(platform)/platform/commerce/revenue/page.tsx",
);
const workspace = repoFile(
  "apps/web/src/app/(platform)/platform/commerce/revenue/RevenueAnalyticsWorkspace.tsx",
);
const proxy = repoFile(
  "apps/web/src/app/api/platform/commerce/revenue-analytics/route.ts",
);
const sidebar = repoFile(
  "apps/web/src/components/platform/PlatformSidebar.tsx",
);

test("revenue analytics are platform-protected and visible in commerce navigation", () => {
  assert.match(page, /requirePermission\("platform\.read"\)/);
  assert.match(sidebar, /\/platform\/commerce\/revenue/);
  assert.match(sidebar, /Revenue Analytics/);
});

test("revenue analytics browser surface is strictly read-only", () => {
  assert.match(workspace, /\/api\/platform\/commerce\/revenue-analytics\?/);
  assert.doesNotMatch(workspace, /method:\s*"POST"/);
  assert.doesNotMatch(workspace, /method:\s*"PATCH"/);
  assert.doesNotMatch(workspace, /method:\s*"PUT"/);
  assert.doesNotMatch(workspace, /method:\s*"DELETE"/);
});

test("revenue analytics proxy preserves server-side window authority", () => {
  assert.match(proxy, /windowDays/);
  assert.match(proxy, /\/commerce\/revenue-analytics/);
  assert.doesNotMatch(proxy, /POST|PATCH|PUT|DELETE/);
});

test("revenue analytics UI keeps evidence semantics explicit", () => {
  assert.match(workspace, /identity-only billing evidence/i);
  assert.match(workspace, /does not mean revenue is \$0/i);
  assert.match(workspace, /not accounting revenue recognition/i);
  assert.match(workspace, /invoice finalization/i);
  assert.match(workspace, /not\s+days past due/i);
  assert.match(workspace, /currency/i);
});

test("revenue analytics does not fabricate empty trends", () => {
  assert.match(workspace, /No invoice trend evidence/);
  assert.match(workspace, /trend\.length/);
  assert.doesNotMatch(
    workspace,
    /generateSynthetic|placeholderRevenue|fakeRevenue/i,
  );
});
