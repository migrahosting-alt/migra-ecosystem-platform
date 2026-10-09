import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/web") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

const workspace = repoFile(
  "apps/web/src/app/(platform)/platform/commerce/catalog/CatalogEntitlementsWorkspace.tsx",
);
const panel = repoFile(
  "apps/web/src/app/(platform)/platform/commerce/catalog/RuntimeReconstructionPanel.tsx",
);
const proxy = repoFile(
  "apps/web/src/app/api/platform/commerce/provisioning/drift/[orgId]/[product]/context/route.ts",
);

test("runtime reconstruction is loaded on demand from the protected platform proxy", () => {
  assert.match(workspace, /Inspect runtime/);
  assert.match(workspace, /\/api\/platform\/commerce\/provisioning\/drift\//);
  assert.match(workspace, /RuntimeReconstructionPanel/);
  assert.match(proxy, /platform\.read/);
  assert.match(proxy, /"\/commerce\/provisioning\/drift\/"/);
  assert.match(proxy, /"\/context"/);
});

test("runtime reconstruction distinguishes missing runtime from malformed legacy replay", () => {
  assert.match(panel, /Runtime reconstruction required/);
  assert.match(panel, /Legacy replay boundary/);
  assert.match(panel, /malformed/);
  assert.match(panel, /Create current MigraPanel tenant/);
  assert.match(panel, /fresh signed entitlement reconciliation/);
});

test("runtime reconstruction keeps all mutations explicit", () => {
  assert.match(panel, /Control-plane guardrail/);
  assert.match(panel, /never creates tenants/);
  assert.match(panel, /Every recovery mutation remains a separate audited operator/);
  assert.doesNotMatch(panel, /method:\s*["'](?:POST|PUT|DELETE)["']/);
  assert.doesNotMatch(proxy, /export async function (?:POST|PUT|PATCH|DELETE)/);
});

test("runtime reconstruction preserves the verified MigraPanel handoff", () => {
  assert.match(panel, /\/console\/clients\/new\?/);
  assert.match(panel, /handoffOrgId/);
  assert.match(panel, /handoffJobId/);
  assert.match(panel, /returnTo/);
  assert.match(workspace, /handoffMode !== "tenant_created"/);
  assert.match(workspace, /verifyReturnedTenant/);
  assert.match(workspace, /Bind tenant to organization/);
});
