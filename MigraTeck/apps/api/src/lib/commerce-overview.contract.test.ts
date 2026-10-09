import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/api") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

const page = repoFile("apps/web/src/app/(platform)/platform/commerce/page.tsx");
const workspace = repoFile(
  "apps/web/src/app/(platform)/platform/commerce/CommerceOverviewWorkspace.tsx",
);

test("commerce overview is global operator evidence, not active-organization commerce", () => {
  assert.doesNotMatch(page, /getCommercialSnapshot/);
  assert.doesNotMatch(page, /activeOrgId/);
  assert.match(page, /requirePermission\("platform\.read"\)/);
  assert.match(page, /CommerceOverviewWorkspace/);
  assert.match(workspace, /not tied to the active organization/);
});

test("commerce overview composes canonical read surfaces without becoming a fourth authority", () => {
  assert.match(workspace, /Promise\.allSettled/);
  assert.match(workspace, /api\/platform\/commerce\/catalog/);
  assert.match(workspace, /api\/platform\/commerce\/billing/);
  assert.match(workspace, /api\/platform\/commerce\/usage/);
  assert.doesNotMatch(workspace, /method:\s*"POST"/);
  assert.doesNotMatch(workspace, /method:\s*"PUT"/);
});

test("commerce overview degrades independently and surfaces cross-system attention", () => {
  assert.match(workspace, /settledState/);
  assert.match(workspace, /SubsystemUnavailable/);
  assert.match(workspace, /Catalog & entitlements/);
  assert.match(workspace, /MigraPay & billing/);
  assert.match(workspace, /Usage & metering/);
  assert.match(workspace, /Cross-system priority queue/);
  assert.match(workspace, /Stripe usage processor blocked/);
  assert.match(workspace, /dead provisioning jobs/);
  assert.match(workspace, /billing webhook events need attention/);
  assert.match(workspace, /usage exports failed/);
  assert.match(workspace, /lack Stripe customer mapping/);
});

test("commerce overview treats missing billing activity as missing evidence", () => {
  assert.match(
    workspace,
    /Billing ledger has no subscription, invoice, or webhook evidence yet/,
  );
  assert.match(workspace, /evidence gap, not a healthy-zero signal/);
  assert.match(
    workspace,
    /No subscription, invoice, or webhook evidence has arrived yet/,
  );
});
