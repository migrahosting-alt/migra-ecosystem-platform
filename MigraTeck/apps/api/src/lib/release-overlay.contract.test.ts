import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function repoRoot() {
  const cwd = process.cwd();
  return cwd.endsWith("/apps/api") ? join(cwd, "../..") : cwd;
}

function file(root: string, path: string, contents: string) {
  const full = join(root, path);
  mkdirSync(full.substring(0, full.lastIndexOf("/")), { recursive: true });
  writeFileSync(full, contents, "utf8");
}

test("overlay inventory classifies production drift without exposing contents", () => {
  const root = mkdtempSync(join(tmpdir(), "migrateck-overlay-"));
  const canonical = join(root, "canonical");
  const release = join(root, "release");
  mkdirSync(canonical, { recursive: true });
  mkdirSync(release, { recursive: true });

  file(canonical, "apps/web/src/app/page.tsx", "canonical page");
  file(release, "apps/web/src/app/page.tsx", "production patch");

  file(canonical, "apps/web/src/app/new/page.tsx", "new canonical route");
  file(release, "apps/web/src/app/console/migraguard/page.tsx", "legacy runtime");
  file(release, "apps/web/public/brands/legacy.png", "asset bytes");
  file(release, "apps/web/tests/fixtures/legacy.sql", "fixture");
  file(release, "RELEASE.json", "{}");

  const output = join(release, "OVERLAY_INVENTORY.json");
  execFileSync(
    "node",
    [
      join(repoRoot(), "scripts/write-overlay-inventory.mjs"),
      "--canonical",
      canonical,
      "--release",
      release,
      "--output",
      output,
      "--commit",
      "fixture-commit",
    ],
    { encoding: "utf8" },
  );

  const manifest = JSON.parse(readFileSync(output, "utf8")) as {
    summary: Record<string, number>;
    entries: Array<Record<string, string | null>>;
  };

  assert.equal(manifest.summary.totalDifferences, 6);
  assert.equal(manifest.summary.productionOnly, 4);
  assert.equal(manifest.summary.modifiedCanonical, 1);
  assert.equal(manifest.summary.missingCanonical, 1);
  assert.equal(manifest.summary.runtimeReconciliation, 3);
  assert.equal(manifest.summary.highCriticality, 3);

  const byPath = new Map(manifest.entries.map((entry) => [entry.path, entry]));
  const productionOnly = byPath.get("apps/web/src/app/console/migraguard/page.tsx");
  assert.equal(productionOnly?.kind, "extra");
  assert.equal(productionOnly?.classification, "runtime_source");
  assert.equal(productionOnly?.criticality, "high");
  assert.equal(productionOnly?.recommendedAction, "reconcile_to_git");
  assert.equal(productionOnly?.canonicalSha256, null);
  assert.match(String(productionOnly?.releaseSha256), /^[a-f0-9]{64}$/);
  assert.equal(
    byPath.get("apps/web/src/app/page.tsx")?.recommendedAction,
    "reconcile_patch",
  );
  assert.match(
    String(byPath.get("apps/web/src/app/page.tsx")?.canonicalSha256),
    /^[a-f0-9]{64}$/,
  );
  assert.match(
    String(byPath.get("apps/web/src/app/page.tsx")?.releaseSha256),
    /^[a-f0-9]{64}$/,
  );
  assert.equal(
    byPath.get("apps/web/src/app/new/page.tsx")?.recommendedAction,
    "deploy_or_intentionally_exclude",
  );
  assert.equal(
    byPath.get("apps/web/public/brands/legacy.png")?.classification,
    "public_asset",
  );
  assert.equal(
    byPath.get("apps/web/tests/fixtures/legacy.sql")?.classification,
    "test_fixture",
  );

  assert.equal(
    byPath.get("RELEASE.json")?.classification,
    "deployment_metadata",
  );
  assert.equal(
    byPath.get("RELEASE.json")?.recommendedAction,
    "retain",
  );
  assert.equal(byPath.has("OVERLAY_INVENTORY.json"), false);
  assert.ok(
    manifest.entries.every(
      (entry) =>
        !Object.values(entry).some(
          (value) =>
            typeof value === "string" &&
            ["canonical page", "production patch", "legacy runtime"].includes(value),
        ),
    ),
  );
});

test("overlay manifest is wired into infrastructure health and operator route", () => {
  const health = readFileSync(
    join(repoRoot(), "apps/api/src/lib/infrastructure-health.ts"),
    "utf8",
  );
  const route = readFileSync(
    join(repoRoot(), "apps/api/src/routes/v1/modules/infrastructure.ts"),
    "utf8",
  );

  assert.match(health, /getReleaseOverlaySnapshot/);
  assert.match(health, /releaseOverlayRuntimeReconciliation/);
  assert.match(health, /overlay: releaseOverlay/);
  assert.match(route, /"\/infrastructure\/overlay"/);
  assert.match(route, /requirePlatformAuthority/);
  assert.match(route, /platform\.self\.read/);
});

test("overlay reader keeps absolute filesystem roots out of operator entries", () => {
  const source = readFileSync(
    join(repoRoot(), "apps/api/src/lib/release-overlay.ts"),
    "utf8",
  );

  assert.match(source, /!entry\.path\.startsWith\("\/"\)/);
  assert.match(source, /hasParentTraversal\(entry\.path\)/);
  assert.match(source, /segment === "\.\."/);
  assert.match(source, /entries\.length > 50_000/);
  assert.match(source, /different installed release/);
  assert.match(source, /publicEntry/);
  assert.match(source, /\.map\(publicEntry\)/);
});

test("inventory ignores retained Next build backups and downgrades non-runtime evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "migrateck-overlay-evidence-"));
  const canonical = join(root, "canonical");
  const release = join(root, "release");
  mkdirSync(canonical, { recursive: true });
  mkdirSync(release, { recursive: true });

  file(canonical, "src/app/page.tsx", "canonical page");
  file(release, "src/app/page.tsx", "canonical page");
  file(release, ".next.commerce-backup/server/page.js", "compiled backup");
  file(release, "src/app/page.contract.test.ts", "test-only evidence");
  file(release, "src/app/page.tsx.prev-20261009T084958Z", "source backup");
  file(release, "next-env.d.ts", "generated next types");
  file(release, "tsconfig.tsbuildinfo", "generated compiler state");

  const output = join(release, "OVERLAY_INVENTORY.json");
  execFileSync(
    "node",
    [
      join(repoRoot(), "scripts/write-overlay-inventory.mjs"),
      "--canonical",
      canonical,
      "--release",
      release,
      "--output",
      output,
      "--commit",
      "fixture-commit",
    ],
    { encoding: "utf8" },
  );

  const manifest = JSON.parse(readFileSync(output, "utf8")) as {
    summary: Record<string, number>;
    entries: Array<Record<string, string | null>>;
  };
  const byPath = new Map(manifest.entries.map((entry) => [entry.path, entry]));

  assert.equal(
    manifest.entries.some((entry) => String(entry.path).startsWith(".next.commerce-backup/")),
    false,
  );
  assert.equal(byPath.get("src/app/page.contract.test.ts")?.classification, "test_fixture");
  assert.equal(byPath.get("src/app/page.contract.test.ts")?.criticality, "low");
  assert.equal(byPath.get("src/app/page.tsx.prev-20261009T084958Z")?.classification, "build_evidence");
  assert.equal(byPath.get("next-env.d.ts")?.classification, "build_evidence");
  assert.equal(byPath.get("tsconfig.tsbuildinfo")?.classification, "build_evidence");
  assert.equal(manifest.summary.highCriticality, 0);
  assert.equal(manifest.summary.runtimeReconciliation, 0);
});

test("overlay policy keeps intentional exclusions visible and reopens overdue review debt", () => {
  const root = mkdtempSync(join(tmpdir(), "migrateck-overlay-policy-"));
  const canonical = join(root, "canonical");
  const release = join(root, "release");
  mkdirSync(canonical, { recursive: true });
  mkdirSync(release, { recursive: true });

  file(canonical, "src/app/active/page.tsx", "active canonical page");
  file(release, "src/app/active/page.tsx", "active canonical page");
  file(canonical, "src/app/future/page.tsx", "future migration page");
  file(canonical, "src/app/overdue/page.tsx", "overdue migration page");

  const policy = join(canonical, "release-overlay-policy.json");
  writeFileSync(
    policy,
    JSON.stringify(
      {
        schemaVersion: 1,
        policyId: "fixture-policy",
        reviewedAt: "2026-10-09T00:00:00.000Z",
        groups: [
          {
            id: "future-review",
            owner: "Platform operations",
            reason:
              "This runtime source is intentionally excluded until its controlled migration is accepted.",
            reviewAfter: "2099-01-01T00:00:00.000Z",
            paths: ["src/app/future/page.tsx"],
          },
          {
            id: "overdue-review",
            owner: "Platform operations",
            reason:
              "This runtime source exclusion is intentionally overdue so the test verifies fail-closed review behavior.",
            reviewAfter: "2000-01-01T00:00:00.000Z",
            paths: ["src/app/overdue/page.tsx"],
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );

  const output = join(release, "OVERLAY_INVENTORY.json");
  execFileSync(
    "node",
    [
      join(repoRoot(), "scripts/write-overlay-inventory.mjs"),
      "--canonical",
      canonical,
      "--release",
      release,
      "--output",
      output,
      "--commit",
      "fixture-policy-commit",
      "--policy",
      policy,
    ],
    { encoding: "utf8" },
  );

  const manifest = JSON.parse(readFileSync(output, "utf8")) as {
    summary: Record<string, number>;
    entries: Array<Record<string, unknown>>;
  };
  const byPath = new Map(manifest.entries.map((entry) => [String(entry.path), entry]));

  assert.equal(manifest.summary.totalDifferences, 3);
  assert.equal(manifest.summary.runtimeReconciliation, 1);
  assert.equal(manifest.summary.highCriticality, 1);
  assert.equal(manifest.summary.intentionalExclusions, 1);
  assert.equal(manifest.summary.overdueExclusions, 1);

  const future = byPath.get("src/app/future/page.tsx");
  assert.equal(future?.policyDecision, "intentionally_excluded");
  assert.equal(future?.policyGroup, "future-review");
  assert.equal(future?.policyOwner, "Platform operations");
  assert.equal(future?.policyOverdue, false);
  assert.equal(future?.recommendedAction, "review_intentional_exclusion");

  const overdue = byPath.get("src/app/overdue/page.tsx");
  assert.equal(overdue?.policyDecision, "intentionally_excluded");
  assert.equal(overdue?.policyGroup, "overdue-review");
  assert.equal(overdue?.policyOverdue, true);
  assert.equal(overdue?.recommendedAction, "review_expired_exclusion");
});

test("overlay policy fails closed when an exclusion path is stale or no longer missing runtime source", () => {
  const root = mkdtempSync(join(tmpdir(), "migrateck-overlay-policy-stale-"));
  const canonical = join(root, "canonical");
  const release = join(root, "release");
  mkdirSync(canonical, { recursive: true });
  mkdirSync(release, { recursive: true });

  file(canonical, "src/app/page.tsx", "same page");
  file(release, "src/app/page.tsx", "same page");

  const policy = join(canonical, "release-overlay-policy.json");
  writeFileSync(
    policy,
    JSON.stringify({
      schemaVersion: 1,
      policyId: "stale-fixture-policy",
      reviewedAt: "2026-10-09T00:00:00.000Z",
      groups: [
        {
          id: "stale-path",
          owner: "Platform operations",
          reason:
            "This fixture intentionally points at a path that is no longer missing from production.",
          reviewAfter: "2099-01-01T00:00:00.000Z",
          paths: ["src/app/page.tsx"],
        },
      ],
    }),
    "utf8",
  );

  assert.throws(
    () =>
      execFileSync(
        "node",
        [
          join(repoRoot(), "scripts/write-overlay-inventory.mjs"),
          "--canonical",
          canonical,
          "--release",
          release,
          "--output",
          join(release, "OVERLAY_INVENTORY.json"),
          "--commit",
          "fixture-policy-commit",
          "--policy",
          policy,
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ),
  );
});
