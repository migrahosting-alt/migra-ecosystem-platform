import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/web") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

const members = repoFile(
  "apps/web/src/app/(platform)/platform/members/page.tsx",
);
const collection = repoFile(
  "apps/web/src/app/api/platform/workforce/route.ts",
);
const detail = repoFile(
  "apps/web/src/app/api/platform/workforce/[staffId]/route.ts",
);
const grant = repoFile(
  "apps/web/src/app/api/platform/workforce/[staffId]/product-access/route.ts",
);
const revoke = repoFile(
  "apps/web/src/app/api/platform/workforce/[staffId]/product-access/[grantId]/route.ts",
);
const suspend = repoFile(
  "apps/web/src/app/api/platform/workforce/[staffId]/suspend/route.ts",
);
const reactivate = repoFile(
  "apps/web/src/app/api/platform/workforce/[staffId]/reactivate/route.ts",
);
const terminate = repoFile(
  "apps/web/src/app/api/platform/workforce/[staffId]/terminate/route.ts",
);

test("Members & Access keeps organization, workforce, and operator authority separate", () => {
  assert.match(members, /Organization membership plane/);
  assert.match(members, /Workforce authority plane/);
  assert.match(members, /PlatformOperatorAccessWorkspace/);
  assert.match(members, /WorkforceAccessWorkspace/);
});

test("workforce collection resolves MigraAuth authority before listing staff", () => {
  assert.match(collection, /fetchAuthApi<AuthorityResponse>\("\/v1\/admin\/me"\)/);
  assert.match(collection, /platform\.workforce\.read/);
  assert.match(collection, /platform\.workforce\.manage/);
  assert.match(collection, /platform\.workforce\.product_access\.manage/);
  assert.match(collection, /\/v1\/admin\/workforce\?/);
});

test("staff creation requires typed confirmation and never invents local authority", () => {
  assert.match(collection, /z\.literal\("CREATE STAFF"\)/);
  assert.match(collection, /forwardWorkforce\(/);
  assert.doesNotMatch(collection, /INSERT INTO|UPDATE |DELETE FROM/i);
});

test("product-role grant and revocation preserve high-risk confirmations", () => {
  assert.match(grant, /GRANT FRENDELO SUPER ADMIN/);
  assert.match(grant, /GRANT PRODUCT ACCESS/);
  assert.match(revoke, /REVOKE PRODUCT ACCESS/);
  assert.match(grant, /forwardWorkforce\(/);
  assert.match(revoke, /forwardWorkforce\(/);
});

test("lifecycle mutations preserve explicit typed confirmation contracts", () => {
  assert.match(suspend, /SUSPEND STAFF/);
  assert.match(reactivate, /REACTIVATE STAFF/);
  assert.match(terminate, /TERMINATE STAFF/);
});

test("detail read remains a MigraAuth Workforce read-through", () => {
  assert.match(detail, /\/v1\/admin\/workforce\//);
  assert.match(detail, /forwardWorkforce\(/);
});
