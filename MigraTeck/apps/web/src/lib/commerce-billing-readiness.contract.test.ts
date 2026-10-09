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
  "apps/web/src/app/(platform)/platform/commerce/readiness/page.tsx",
);
const workspace = repoFile(
  "apps/web/src/app/(platform)/platform/commerce/readiness/BillingReadinessWorkspace.tsx",
);
const proxy = repoFile(
  "apps/web/src/app/api/platform/commerce/billing-readiness/route.ts",
);
const sidebar = repoFile(
  "apps/web/src/components/platform/PlatformSidebar.tsx",
);

test("billing readiness is platform-protected and visible in Commerce navigation", () => {
  assert.match(page, /requirePermission\("platform\.read"\)/);
  assert.match(sidebar, /\/platform\/commerce\/readiness/);
  assert.match(sidebar, /Billing Readiness/);
});

test("billing readiness browser surface is strictly read-only", () => {
  assert.match(workspace, /\/api\/platform\/commerce\/billing-readiness/);
  assert.doesNotMatch(workspace, /method:\s*"POST"/);
  assert.doesNotMatch(workspace, /method:\s*"PATCH"/);
  assert.doesNotMatch(workspace, /method:\s*"PUT"/);
  assert.doesNotMatch(workspace, /method:\s*"DELETE"/);
});

test("billing readiness proxy preserves platform authority", () => {
  assert.match(proxy, /getAppSession/);
  assert.match(proxy, /platform\.read/);
  assert.match(proxy, /\/commerce\/billing-readiness/);
});

test("readiness UI distinguishes first-delivery waiting from observed health", () => {
  assert.match(workspace, /Awaiting first canonical delivery/);
  assert.match(workspace, /No post-cutover Stripe event has been emitted yet/);
  assert.match(workspace, /deliveryState/);
  assert.match(workspace, /missingLocalDeliveries/);
});

test("readiness UI exposes evidence without secrets or money-moving actions", () => {
  assert.match(workspace, /Endpoint event coverage/);
  assert.match(workspace, /Mapped organizations reconciled/);
  assert.match(workspace, /never performs\s+charges, refunds, credits/);
  assert.doesNotMatch(workspace, /STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET/);
});
