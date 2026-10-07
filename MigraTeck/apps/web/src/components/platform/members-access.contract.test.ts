import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/web") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

const page = repoFile("apps/web/src/app/(platform)/platform/members/page.tsx");
const operatorProxy = repoFile(
  "apps/web/src/app/api/platform/access/operator/route.ts",
);
const roleProxy = repoFile(
  "apps/web/src/app/api/platform/access/operator/roles/route.ts",
);
const userProxy = repoFile(
  "apps/web/src/app/api/platform/access/operator/users/route.ts",
);
const membersWorkspace = repoFile(
  "apps/web/src/components/platform/MembersWorkspace.tsx",
);

test("Members & Access renders organization and platform authority as separate planes", () => {
  assert.match(page, /Members & Access/);
  assert.match(page, /Organization membership plane/);
  assert.match(page, /PlatformOperatorAccessWorkspace/);
  assert.match(page, /Tenant-scoped membership/);
  assert.match(page, /MigraTeck-wide authority/);
});

test("platform operator access does not require an active organization", () => {
  const operatorIndex = page.indexOf("<PlatformOperatorAccessWorkspace");
  const emptyStateIndex = page.indexOf("<PlatformEmptyState");
  assert.ok(operatorIndex > 0);
  assert.ok(emptyStateIndex > 0);
  assert.ok(
    operatorIndex > emptyStateIndex,
    "operator workspace remains rendered after the organization empty-state branch",
  );
  assert.doesNotMatch(operatorProxy, /activeOrgId|x-org-id|organizations\//);
});

test("operator authority is resolved from MigraAuth admin authority", () => {
  assert.match(operatorProxy, /fetchAuthApi<AuthorityResponse>\("\/v1\/admin\/me"\)/);
  assert.match(operatorProxy, /fetchAuthApi<RoleListResponse>\("\/v1\/admin\/roles"\)/);
  assert.match(operatorProxy, /platform\.roles\.manage/);
  assert.match(operatorProxy, /operator:\s*false/);
});

test("role mutation proxy only accepts the closed platform role set", () => {
  assert.match(
    roleProxy,
    /z\.enum\(\["support", "operator", "owner"\]\)/,
  );
  assert.match(roleProxy, /method:\s*"POST"/);
  assert.match(roleProxy, /method:\s*"DELETE"/);
  assert.match(roleProxy, /\/v1\/admin\/roles/);
});

test("grant target search uses the MigraAuth operator user directory", () => {
  assert.match(userProxy, /\/v1\/admin\/users\?/);
  assert.doesNotMatch(userProxy, /organizations\//);
});

test("organization member UI points to the access plane instead of Trust Operations", () => {
  assert.match(membersWorkspace, /href="#platform-operator-access"/);
  assert.doesNotMatch(membersWorkspace, /Platform roles live in Trust Operations/);
});
