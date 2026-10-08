import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildPlatformHostingReturn,
  sanitizePlatformHostingReturn,
} from "./platform-handoff.js";

const previousAppBase = process.env.APP_BASE_URL;
const previousLaunch = process.env.MIGRATECK_LAUNCH_URL;
process.env.APP_BASE_URL = "https://migrateck.com";
process.env.MIGRATECK_LAUNCH_URL = "https://migrateck.com";

test.after(() => {
  if (previousAppBase === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = previousAppBase;
  if (previousLaunch === undefined) delete process.env.MIGRATECK_LAUNCH_URL;
  else process.env.MIGRATECK_LAUNCH_URL = previousLaunch;
});

test("platform Hosting return allowlists the MigraTeck origin and exact path", () => {
  assert.equal(
    sanitizePlatformHostingReturn(
      "https://migrateck.com/platform/hosting?evil=1#fragment",
    ),
    "https://migrateck.com/platform/hosting",
  );
  assert.equal(
    sanitizePlatformHostingReturn("https://migrateck.com/platform/hosting/"),
    "https://migrateck.com/platform/hosting",
  );

  assert.equal(
    sanitizePlatformHostingReturn("https://evil.example/platform/hosting"),
    null,
  );
  assert.equal(
    sanitizePlatformHostingReturn("https://migrateck.com/platform/billing"),
    null,
  );
  assert.equal(
    sanitizePlatformHostingReturn(
      "https://user:pass@migrateck.com/platform/hosting",
    ),
    null,
  );
});

test("tenant creation return carries only reviewed handoff context", () => {
  const url = buildPlatformHostingReturn({
    returnTo: "https://migrateck.com/platform/hosting",
    createdTenantId: "123e4567-e89b-12d3-a456-426614174000",
    handoffOrgId: "org_abc-123",
  });

  assert.ok(url);
  const parsed = new URL(url!);
  assert.equal(parsed.origin, "https://migrateck.com");
  assert.equal(parsed.pathname, "/platform/hosting");
  assert.equal(parsed.searchParams.get("handoff"), "tenant_created");
  assert.equal(
    parsed.searchParams.get("createdTenantId"),
    "123e4567-e89b-12d3-a456-426614174000",
  );
  assert.equal(parsed.searchParams.get("handoffOrgId"), "org_abc-123");
});

test("invalid tenant IDs cannot become Platform handoff returns", () => {
  assert.equal(
    buildPlatformHostingReturn({
      returnTo: "https://migrateck.com/platform/hosting",
      createdTenantId: "../../console/admin",
      handoffOrgId: "org_abc",
    }),
    null,
  );
});

test("MigraPanel tenant creation action rechecks console authentication", () => {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/web") ? join(cwd, "../..") : cwd;
  const page = readFileSync(
    join(root, "apps/web/src/app/console/clients/new/page.tsx"),
    "utf8",
  );

  assert.match(page, /const session = await getSession\(\)/);
  assert.match(page, /if \(!session\) redirect\("\/console\/login"\)/);
  assert.match(page, /buildPlatformHostingReturn/);
  assert.match(page, /name="returnTo"/);
  assert.match(page, /name="handoffOrgId"/);
});

test("Platform handoff never bypasses binding authority", () => {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/web") ? join(cwd, "../..") : cwd;
  const workspace = readFileSync(
    join(
      root,
      "apps/web/src/app/(platform)/platform/hosting/HostingWorkspace.tsx",
    ),
    "utf8",
  );

  assert.match(workspace, /canManageBindings !== true/);
  assert.match(workspace, /platform\.hosting\.bindings\.manage is required/);
  assert.match(workspace, /\/recovery-context/);
  assert.match(workspace, /Bind this tenant/);
});
