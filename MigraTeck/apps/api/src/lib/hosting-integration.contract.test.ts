import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  hostingTenantExternalId,
  tenantIdFromHostingExternalId,
} from "./hosting-integration.js";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/api") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

const routes = repoFile("apps/api/src/routes/v1/modules/hosting.ts");
const model = repoFile("apps/api/src/lib/hosting-integration.ts");

test("MigraPanel tenant external IDs round-trip without heuristic names", () => {
  const id = "119b8385-5d46-46c1-968a-1ac0f4f06809";
  const externalId = hostingTenantExternalId(id);
  assert.equal(externalId, "migrapanel:tenant:" + id);
  assert.equal(tenantIdFromHostingExternalId(externalId), id);
  assert.equal(tenantIdFromHostingExternalId("tenant:" + id), null);
  assert.equal(tenantIdFromHostingExternalId(null), null);
});

test("organization Hosting reads require verified org membership and exclude billing-only role", () => {
  assert.match(
    routes,
    /requireOrganizationPrincipal\(request, \[\s*"OWNER",\s*"ADMIN",\s*"MEMBER",?\s*\]\)/,
  );
  assert.doesNotMatch(routes, /"BILLING_ADMIN"/);
});

test("cross-system tenant discovery and mutation use platform Hosting authority", () => {
  assert.match(routes, /"platform\.hosting\.read"/);
  assert.match(routes, /"platform\.hosting\.bindings\.manage"/);
  assert.match(
    routes,
    /app\.put\("\/hosting\/organizations\/:orgId\/binding"/,
  );
  assert.match(
    routes,
    /app\.delete\("\/hosting\/organizations\/:orgId\/binding"/,
  );
});

test("binding uses the resource graph and is audited", () => {
  assert.match(model, /'TENANT'::"ResourceNodeType"/);
  assert.match(model, /'MIGRAHOSTING'::"ProductKey"/);
  assert.match(model, /HOSTING_TENANT_BOUND/);
  assert.match(model, /HOSTING_TENANT_REBOUND/);
  assert.match(model, /HOSTING_TENANT_UNBOUND/);
  assert.match(model, /INSERT INTO "AuditLog"/);
});

test("Hosting snapshot never selects certificate or private-key material", () => {
  assert.doesNotMatch(model, /"certificateData"/);
  assert.doesNotMatch(model, /"privateKeyData"/);
  assert.doesNotMatch(model, /"chainData"/);
  assert.match(model, /"domainName"/);
  assert.match(model, /"expiresAt"/);
});

test("parent Platform does not duplicate destructive MigraPanel Hosting operations", () => {
  assert.doesNotMatch(routes, /suspend|pause|resume|deploy|backup|runtime|sftp|database/i);
  assert.match(routes, /getOrganizationHostingSnapshot/);
});
