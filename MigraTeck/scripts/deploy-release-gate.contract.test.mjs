import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const deployScript = readFileSync(join(root, "scripts/deploy-production.sh"), "utf8");

test("production web deploy runs reconciliation before build or remote sync", () => {
  const gateDefinition = deployScript.indexOf("run_release_overlay_gate()");
  const gateInvocation = deployScript.lastIndexOf("\nrun_release_overlay_gate\n");
  const checksInvocation = deployScript.lastIndexOf("\nrun_workspace_checks\n");
  const remoteSyncInvocation = deployScript.lastIndexOf("\n  run_remote_sync\n");

  assert.ok(gateDefinition >= 0, "release reconciliation gate must exist");
  assert.ok(gateInvocation > gateDefinition, "release gate must be invoked");
  assert.ok(checksInvocation > gateInvocation, "release gate must run before workspace checks");
  assert.ok(remoteSyncInvocation > checksInvocation, "workspace checks must precede remote sync");
});

test("release gate is web-only, defaults on, and fails closed on reconciliation blockers", () => {
  assert.match(deployScript, /DEPLOY_RELEASE_GATE="\$\{DEPLOY_RELEASE_GATE:-true\}"/);
  assert.match(deployScript, /DEPLOY_WORKSPACE}" != "@migrateck\/web"/);
  assert.match(deployScript, /--classification runtime_source/);
  assert.match(deployScript, /--fail-on-blockers/);
  assert.match(deployScript, /Web release blocked: reconcile production runtime source before deployment/);
});

test("release gate fetches the installed inventory and always cleans its temporary copy", () => {
  assert.match(deployScript, /DEPLOY_OVERLAY_INVENTORY_PATH=/);
  assert.match(deployScript, /fetch installed web overlay inventory/);
  const removals = deployScript.match(/rm -f "\$\{inventory\}"/g) ?? [];
  assert.ok(removals.length >= 2, "temporary inventory must be removed on fetch failure and after analysis");
});
