import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/api") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

const service = repoFile(
  "apps/api/src/lib/provisioning-runtime-reconstruction.ts",
);
const routes = repoFile("apps/api/src/routes/v1/modules/commerce-catalog.ts");

test("runtime reconstruction context is read-only and commerce-authority scoped", () => {
  assert.match(
    routes,
    /"\/commerce\/provisioning\/drift\/:orgId\/:product\/context"[\s\S]*?"platform\.commerce\.read"/,
  );
  assert.match(routes, /getProvisioningRuntimeReconstructionContext/);
  assert.doesNotMatch(
    service,
    /INSERT INTO|UPDATE "ResourceNode"|DELETE FROM|bindOrganizationToMigraPanelTenant/,
  );
});

test("runtime reconstruction checks current binding and live MigraPanel evidence", () => {
  assert.match(service, /getHostingRuntimeStatus/);
  assert.match(service, /getHostingTenantBinding/);
  assert.match(service, /getHostingRecoveryCandidates/);
  assert.match(service, /getHostingRecoveryCandidateByTenantId/);
  assert.match(service, /runtime_reconstruction_required/);
  assert.match(service, /existing_tenant_candidate/);
  assert.match(service, /runtime_linked/);
});

test("runtime reconstruction evaluates legacy replay safety instead of replaying blindly", () => {
  assert.match(service, /getDeadLetterRemediation/);
  assert.match(service, /malformedJobs/);
  assert.match(service, /payloadHashValid/);
  assert.match(service, /signatureValid/);
  assert.match(service, /readyToRetryJobs/);
  assert.match(service, /legacyReplayBlocked/);
  assert.match(service, /noAutomaticReplay: true/);
});

test("runtime reconstruction never returns raw provisioning payloads or secrets", () => {
  assert.doesNotMatch(service, /SELECT[\s\S]*?payload\s+AS/i);
  assert.doesNotMatch(service, /signature:\s*remediation/i);
  assert.doesNotMatch(service, /payloadHash:\s*remediation/i);
  assert.doesNotMatch(service, /mailboxPassword/);
  assert.match(service, /safeContext/);
});

test("runtime reconstruction requires a current tenant before safe hosting recovery", () => {
  assert.match(service, /create_current_tenant_then_bind_and_reconcile/);
  assert.match(
    service,
    /Historical jobs include malformed envelopes and must not be replayed/,
  );
  assert.match(
    service,
    /Historical jobs do not contain enough hosting context to provision safely/,
  );
  assert.match(service, /noAutomaticTenantCreation: true/);
  assert.match(service, /noAutomaticBinding: true/);
});
