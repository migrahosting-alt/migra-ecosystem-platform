import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { workerStateForAge } from "./infrastructure-health.js";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/api") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

test("worker heartbeat classification is fail-closed", () => {
  assert.equal(workerStateForAge(0, 45), "healthy");
  assert.equal(workerStateForAge(45, 45), "healthy");
  assert.equal(workerStateForAge(46, 45), "stale");
  assert.equal(workerStateForAge(null, 45), "stale");
});

test("infrastructure health requires MigraAuth platform-operator authority", () => {
  const route = repoFile("apps/api/src/routes/v1/modules/infrastructure.ts");
  assert.match(route, /requirePlatformAuthority\(request, \[\s*"platform\.self\.read"/);
  assert.doesNotMatch(route, /requireOrganizationPrincipal/);
});

test("all background workers publish or consume dedicated heartbeat paths", () => {
  const health = repoFile("apps/api/src/lib/infrastructure-health.ts");
  const webhook = repoFile("apps/api/src/webhook-worker.ts");
  const social = repoFile("apps/api/src/social-connection-sync-worker.ts");
  const socialUnit = repoFile("deploy/migrateck-social-sync-worker.service");

  for (const fragment of [
    "/run/migrateck-provisioning/heartbeat.json",
    "/run/migrateck-entitlement-expiry/heartbeat.json",
    "/run/migrateck-usage/heartbeat.json",
    "/run/migrateck-billing-reconcile/heartbeat.json",
    "/run/migrateck-social-sync/heartbeat.json",
    "/run/migrateck-webhook/heartbeat.json",
  ]) {
    assert.ok(health.includes(fragment), fragment);
  }

  assert.match(webhook, /WEBHOOK_WORKER_HEARTBEAT_FILE/);
  assert.match(webhook, /lastSeenAt/);
  assert.match(webhook, /removeHeartbeat/);

  assert.match(social, /SOCIAL_CONNECTION_SYNC_HEARTBEAT_FILE/);
  assert.match(social, /lastSeenAt/);
  assert.match(social, /removeHeartbeat/);
  assert.match(socialUnit, /dist\/social-connection-sync-worker\.js/);
  assert.match(socialUnit, /RuntimeDirectory=migrateck-social-sync/);
});

test("billing reconciliation worker participates in platform-wide liveness", () => {
  const health = repoFile("apps/api/src/lib/infrastructure-health.ts");
  const panel = repoFile(
    "apps/web/src/components/platform/InfrastructureHealthPanel.tsx",
  );

  assert.match(health, /billing_reconciliation/);
  assert.match(health, /BILLING_RECONCILIATION_HEARTBEAT_FILE/);
  assert.match(health, /migrateck-billing-reconcile\/heartbeat\.json/);
  assert.match(health, /expectedMaxAgeSeconds: 195/);
  assert.match(panel, /billing_reconciliation/);
});

test("usage health reads the real UsageEvent export lifecycle", () => {
  const health = repoFile("apps/api/src/lib/infrastructure-health.ts");
  assert.match(health, /FROM "UsageEvent"/);
  assert.match(health, /"exportStatus"='PENDING_EXPORT'/);
  assert.match(health, /"exportStatus"='RUNNING'/);
  assert.match(health, /"exportStatus"='RETRY'/);
  assert.match(health, /"exportStatus"='FAILED'/);
  assert.doesNotMatch(health, /UsageExportJob/);
});


test("social infrastructure health uses the secret-safe operator classification and redacted diagnostics", () => {
  const health = repoFile("apps/api/src/lib/infrastructure-health.ts");
  const social = repoFile("apps/api/src/lib/social-connection-sync.ts");
  const panel = repoFile(
    "apps/web/src/components/platform/InfrastructureHealthPanel.tsx",
  );

  assert.match(health, /getSocialConnectionOperationsSnapshot/);
  assert.match(health, /connections: socialConnections\.rows\.map/);
  assert.match(health, /socialProviderSetupRequired/);
  assert.match(health, /socialIntegrationRequired/);
  assert.match(health, /missingCredential/);
  assert.doesNotMatch(health, /missingCredentialReconnect/);

  assert.match(social, /providerSetupRequired/);
  assert.match(social, /integrationRequired/);
  assert.match(social, /operatorAction/);
  assert.match(panel, /Social recovery evidence/);
  assert.match(panel, /Open Social Connections/);
  assert.match(panel, /\/platform\/social/);
});

test("host capacity makes disk and release pressure part of operator health", () => {
  const health = repoFile("apps/api/src/lib/infrastructure-health.ts");
  const capacity = repoFile("apps/api/src/lib/host-capacity.ts");
  const panel = repoFile(
    "apps/web/src/components/platform/InfrastructureHealthPanel.tsx",
  );

  assert.match(health, /getHostCapacitySnapshot/);
  assert.match(health, /hostCapacityState/);
  assert.match(health, /diskUsedPercent/);
  assert.match(health, /host: hostCapacity/);

  assert.match(capacity, /statfs/);
  assert.match(capacity, /MIGRATECK_DISK_CRITICAL_PERCENT/);
  assert.match(capacity, /MIGRATECK_RELEASE_ROOT/);

  assert.match(panel, /Runtime capacity/);
  assert.match(panel, /Host headroom & release pressure/);
  assert.match(panel, /data\.host\.disk\.usedPercent/);
  assert.match(panel, /data\.host\.releases\.count/);
});

test("release provenance is generated by builds and surfaced in operator health", () => {
  const health = repoFile("apps/api/src/lib/infrastructure-health.ts");
  const panel = repoFile(
    "apps/web/src/components/platform/InfrastructureHealthPanel.tsx",
  );
  const apiPackage = repoFile("apps/api/package.json");
  const webPackage = repoFile("apps/web/package.json");

  assert.match(health, /getReleaseIntegritySnapshot/);
  assert.match(health, /releaseIntegrityIssues/);
  assert.match(health, /releases: releaseIntegrity/);

  assert.match(panel, /Release integrity/);
  assert.match(panel, /sourceMatches/);
  assert.match(panel, /artifactMatches/);
  assert.match(panel, /releaseIntegrityIssues/);

  assert.match(apiPackage, /write-release-manifest\.mjs/);
  assert.match(apiPackage, /migrateck-platform-api/);
  assert.match(webPackage, /write-release-manifest\.mjs/);
  assert.match(webPackage, /migrateck-platform-web/);
});

test("provisioning health reports shared active-access drift instead of dead letters alone", () => {
  const health = repoFile("apps/api/src/lib/infrastructure-health.ts");
  const drift = repoFile("apps/api/src/lib/provisioning-drift.ts");
  const panel = repoFile(
    "apps/web/src/components/platform/InfrastructureHealthPanel.tsx",
  );

  assert.match(health, /getProvisioningDriftSnapshot/);
  assert.match(drift, /WITH dead AS/);
  assert.match(drift, /LEFT JOIN "OrgEntitlement" e/);
  assert.match(drift, /active_access_needs_verification/);
  assert.match(drift, /synthetic_test_data/);
  assert.match(drift, /rollout_policy_blocked/);
  assert.match(health, /provisioningDriftNeedsVerification/);
  assert.match(health, /driftCorrelatedDeadJobs/);
  assert.match(health, /historicalNeedsReview/);

  assert.match(panel, /Provisioning verification/);
  assert.match(panel, /provisioningDriftNeedsVerification/);
  assert.match(panel, /href="\/platform\/commerce\/catalog"/);
});

test("release overlay health separates unresolved drift from governed exclusions", () => {
  const health = repoFile("apps/api/src/lib/infrastructure-health.ts");
  const overlay = repoFile("apps/api/src/lib/release-overlay.ts");
  const panel = repoFile(
    "apps/web/src/components/platform/InfrastructureHealthPanel.tsx",
  );

  assert.match(health, /releaseOverlayIntentionalExclusions/);
  assert.match(health, /releaseOverlayOverdueExclusions/);
  assert.match(health, /releaseOverlay\.summary\.intentionalExclusions/);
  assert.match(health, /releaseOverlay\.summary\.overdueExclusions/);

  assert.match(overlay, /policyDecision/);
  assert.match(overlay, /policyOverdue/);
  assert.match(overlay, /time-bounded intentional exclusion/);

  assert.match(panel, /Release overlay policy/);
  assert.match(panel, /Unresolved runtime/);
  assert.match(panel, /Intentional exclusions/);
  assert.match(panel, /Overdue reviews/);
  assert.match(panel, /releaseOverlayOverdueExclusions > 0/);
});
