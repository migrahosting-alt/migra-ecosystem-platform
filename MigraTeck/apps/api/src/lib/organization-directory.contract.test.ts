import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/api") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

const routes = repoFile(
  "apps/api/src/routes/v1/modules/organization-directory.ts",
);
const model = repoFile("apps/api/src/lib/organization-directory.ts");
const authAdmin = repoFile("apps/auth-api/src/routes/admin.ts");
const authRoles = repoFile(
  "apps/auth-api/src/modules/authorization/platformRoles.ts",
);
const webProxy = repoFile(
  "apps/web/src/app/api/platform/organization-directory/route.ts",
);

test("global organization directory is platform-authority scoped", () => {
  assert.match(
    authAdmin,
    /"\/v1\/admin\/organizations"[\s\S]{0,220}requirePermission\("platform\.organizations\.read"\)/,
  );
  assert.match(
    routes,
    /"\/organizations\/directory"[\s\S]{0,260}"platform\.organizations\.read"/,
  );
  assert.match(authRoles, /"platform\.organizations\.read"/);
  assert.match(webProxy, /fetchPlatformAuthorityApi/);
  assert.doesNotMatch(routes, /requireOrganizationPrincipal/);
});

test("reconciliation is stronger than directory visibility", () => {
  assert.match(
    routes,
    /"\/organizations\/:orgId\/link-identity"[\s\S]{0,260}"platform\.organizations\.manage"/,
  );
  assert.match(
    routes,
    /"\/organizations\/:orgId\/sync-identity"[\s\S]{0,260}"platform\.organizations\.manage"/,
  );

  const operatorBundle = authRoles.match(
    /OPERATOR:\s*\[([\s\S]*?)\n\s*\],/,
  )?.[1] ?? "";
  assert.match(operatorBundle, /platform\.organizations\.read/);
  assert.doesNotMatch(operatorBundle, /platform\.organizations\.manage/);
});

test("organization directory has no unlink, delete, or classification mutation route", () => {
  assert.doesNotMatch(routes, /unlink-identity/);
  assert.doesNotMatch(routes, /app\.delete\(/);
  assert.doesNotMatch(routes, /isMigraHostingClient/);

  const updates = [...model.matchAll(/UPDATE "Organization" SET ([^']+)/g)].map(
    (match) => match[1] ?? "",
  );
  assert.ok(updates.length >= 2);
  for (const update of updates) {
    assert.doesNotMatch(update, /isMigraHostingClient/);
  }
});

test("identity linking refuses existing links on both sides", () => {
  assert.match(
    model,
    /already linked to a different MigraAuth organization/,
  );
  assert.match(
    model,
    /MigraAuth organization is already linked to another Platform organization/,
  );
  assert.match(
    model,
    /SELECT id FROM "Organization" WHERE "authOrganizationId"=\$1 AND id<>\$2/,
  );
});

test("metadata synchronization requires the exact existing identity link", () => {
  assert.match(
    model,
    /row\.authOrganizationId !== input\.identity\.id/,
  );
  assert.match(
    model,
    /must be linked to this MigraAuth organization before metadata can be synchronized/,
  );
  assert.match(
    model,
    /Cannot synchronize identity slug because another Platform organization already uses it/,
  );
});

test("reconciliation state and its audit commit in the same transaction", () => {
  const linkStart = model.indexOf("export async function linkOrganizationIdentity");
  const syncStart = model.indexOf(
    "export async function syncOrganizationIdentityMetadata",
  );
  const linkBlock = model.slice(linkStart, syncStart);
  const syncBlock = model.slice(syncStart);

  for (const block of [linkBlock, syncBlock]) {
    assert.match(block, /client\.query\("BEGIN"\)/);
    assert.match(block, /await audit\(client,/);
    assert.match(block, /client\.query\("COMMIT"\)/);
    assert.ok(
      block.indexOf("await audit(client,") < block.indexOf('client.query("COMMIT")'),
      "audit must be written before transaction commit",
    );
  }
});
