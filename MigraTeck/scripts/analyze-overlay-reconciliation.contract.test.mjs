import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}

function write(root, rel, value) {
  const full = join(root, rel);
  mkdirSync(full.substring(0, full.lastIndexOf("/")), { recursive: true });
  writeFileSync(full, value, "utf8");
}

function repoRoot() {
  return process.cwd();
}

test("overlay reconciliation blocks production-only and divergent runtime source", () => {
  const root = mkdtempSync(join(tmpdir(), "migrateck-reconcile-"));
  const workspace = join(root, "apps/web");
  mkdirSync(workspace, { recursive: true });

  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "reconcile@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Reconcile Test"], { cwd: root });

  write(root, "apps/web/src/new.ts", "new committed candidate");
  write(root, "apps/web/src/prod-committed.ts", "production extra");
  write(root, "apps/web/src/patch.ts", "canonical-old");
  write(root, "apps/web/src/three.ts", "canonical-old");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: root, stdio: "ignore" });

  // Local recovery / divergence after the committed candidate.
  write(root, "apps/web/src/recovered.ts", "production recovered");
  write(root, "apps/web/src/patch.ts", "production-patch");
  write(root, "apps/web/src/three.ts", "workspace-third");

  const inventory = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    canonicalCommit: "fixture-baseline",
    releaseLabel: "fixture-release",
    summary: {
      totalDifferences: 6,
      productionOnly: 3,
      modifiedCanonical: 2,
      missingCanonical: 1,
      runtimeReconciliation: 6,
      highCriticality: 6,
    },
    byClassification: { runtime_source: 6 },
    byAction: {},
    entries: [
      {
        path: "src/new.ts",
        kind: "missing",
        classification: "runtime_source",
        criticality: "high",
        recommendedAction: "deploy_or_intentionally_exclude",
        canonicalSha256: sha("old-new-baseline"),
        releaseSha256: null,
      },
      {
        path: "src/prod-committed.ts",
        kind: "extra",
        classification: "runtime_source",
        criticality: "high",
        recommendedAction: "reconcile_to_git",
        canonicalSha256: null,
        releaseSha256: sha("production extra"),
      },
      {
        path: "src/production-only.ts",
        kind: "extra",
        classification: "runtime_source",
        criticality: "high",
        recommendedAction: "reconcile_to_git",
        canonicalSha256: null,
        releaseSha256: sha("only in production"),
      },
      {
        path: "src/recovered.ts",
        kind: "extra",
        classification: "runtime_source",
        criticality: "high",
        recommendedAction: "reconcile_to_git",
        canonicalSha256: null,
        releaseSha256: sha("production recovered"),
      },
      {
        path: "src/patch.ts",
        kind: "modified",
        classification: "runtime_source",
        criticality: "high",
        recommendedAction: "reconcile_patch",
        canonicalSha256: sha("canonical-old"),
        releaseSha256: sha("production-patch"),
      },
      {
        path: "src/three.ts",
        kind: "modified",
        classification: "runtime_source",
        criticality: "high",
        recommendedAction: "reconcile_patch",
        canonicalSha256: sha("canonical-old"),
        releaseSha256: sha("production-patch"),
      },
    ],
  };

  const inventoryPath = join(root, "inventory.json");
  writeFileSync(inventoryPath, JSON.stringify(inventory), "utf8");

  const script = join(repoRoot(), "scripts/analyze-overlay-reconciliation.mjs");
  const result = spawnSync(
    "node",
    [
      script,
      "--inventory",
      inventoryPath,
      "--workspace",
      workspace,
      "--git-root",
      root,
      "--git-prefix",
      "apps/web",
    ],
    { cwd: repoRoot(), encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.summary.total, 6);
  assert.equal(output.summary.blocking, 4);
  assert.equal(output.summary.nonBlocking, 2);
  assert.equal(output.summary.cutoverSafe, false);
  assert.equal(output.counts.committed_pending_deploy, 1);
  assert.equal(output.counts.production_extra_committed, 1);
  assert.equal(output.counts.production_only_not_in_workspace, 1);
  assert.equal(output.counts.production_extra_recovered_uncommitted, 1);
  assert.equal(output.counts.production_patch_recovered_uncommitted, 1);
  assert.equal(output.counts.three_way_divergence, 1);

  const gated = spawnSync(
    "node",
    [
      script,
      "--inventory",
      inventoryPath,
      "--workspace",
      workspace,
      "--git-root",
      root,
      "--git-prefix",
      "apps/web",
      "--fail-on-blockers",
    ],
    { cwd: repoRoot(), encoding: "utf8" },
  );
  assert.equal(gated.status, 20);
});

test("overlay reconciliation fails closed when fingerprints are absent", () => {
  const root = mkdtempSync(join(tmpdir(), "migrateck-reconcile-old-"));
  const workspace = join(root, "workspace");
  mkdirSync(workspace, { recursive: true });
  write(workspace, "src/legacy.ts", "production copy");

  const inventoryPath = join(root, "inventory.json");
  writeFileSync(
    inventoryPath,
    JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      canonicalCommit: "old",
      releaseLabel: "old-release",
      entries: [
        {
          path: "src/legacy.ts",
          kind: "extra",
          classification: "runtime_source",
          criticality: "high",
          recommendedAction: "reconcile_to_git",
        },
      ],
    }),
    "utf8",
  );

  const result = spawnSync(
    "node",
    [
      join(repoRoot(), "scripts/analyze-overlay-reconciliation.mjs"),
      "--inventory",
      inventoryPath,
      "--workspace",
      workspace,
    ],
    { cwd: repoRoot(), encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.counts.inventory_missing_fingerprints, 1);
  assert.equal(output.summary.cutoverSafe, false);
});


test("overlay reconciliation allows Next catch-all names but rejects parent traversal segments", () => {
  const root = mkdtempSync(join(tmpdir(), "migrateck-reconcile-paths-"));
  const workspace = join(root, "workspace");
  mkdirSync(workspace, { recursive: true });

  const safeInventory = join(root, "safe.json");
  writeFileSync(
    safeInventory,
    JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      canonicalCommit: "fixture",
      releaseLabel: "fixture",
      entries: [
        {
          path: "src/app/api/governance/[...path]/route.ts",
          kind: "extra",
          classification: "runtime_source",
          criticality: "high",
          recommendedAction: "reconcile_to_git",
          canonicalSha256: null,
          releaseSha256: sha("production catch-all"),
        },
      ],
    }),
    "utf8",
  );

  const script = join(repoRoot(), "scripts/analyze-overlay-reconciliation.mjs");
  const safe = spawnSync(
    "node",
    [script, "--inventory", safeInventory, "--workspace", workspace],
    { cwd: repoRoot(), encoding: "utf8" },
  );
  assert.equal(safe.status, 0, safe.stderr);
  assert.equal(
    JSON.parse(safe.stdout).counts.production_only_not_in_workspace,
    1,
  );

  const unsafeInventory = join(root, "unsafe.json");
  writeFileSync(
    unsafeInventory,
    JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      canonicalCommit: "fixture",
      releaseLabel: "fixture",
      entries: [
        {
          path: "src/../secret.ts",
          kind: "extra",
          classification: "runtime_source",
          criticality: "high",
          recommendedAction: "reconcile_to_git",
          canonicalSha256: null,
          releaseSha256: sha("secret"),
        },
      ],
    }),
    "utf8",
  );
  const unsafe = spawnSync(
    "node",
    [script, "--inventory", unsafeInventory, "--workspace", workspace],
    { cwd: repoRoot(), encoding: "utf8" },
  );
  assert.notEqual(unsafe.status, 0);
  assert.match(unsafe.stderr, /unsafe path/);
});
