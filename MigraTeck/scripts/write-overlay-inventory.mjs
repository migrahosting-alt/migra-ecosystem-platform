import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";

function arg(name, fallback = null) {
  const index = process.argv.indexOf("--" + name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function isInside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + sep));
}

const SKIP_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  "node_modules",
  "dist",
  "coverage",
  ".pnpm-store",
]);

const DEPLOYMENT_METADATA = new Set([
  "BASE_RELEASE",
  "BASE_RELEASE_PROVENANCE.json",
  "COMMERCE_ENTITLEMENTS_REVISION",
  "DEPLOYMENT.txt",
  "OVERLAY_INVENTORY.json",
  "PREVIOUS_RELEASE",
  "RELEASE.json",
  "RELEASE_PROVENANCE.json",
  "RELEASE_SOURCE",
  ".migrateck-release-commit",
]);

async function listFiles(root, prefix = "") {
  const directory = resolve(root, prefix);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? prefix + "/" + entry.name : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      files.push(...await listFiles(root, rel));
      continue;
    }
    if (entry.isFile()) files.push(rel);
  }
  return files;
}

async function hashFile(root, rel) {
  const full = resolve(root, rel);
  if (!isInside(root, full)) throw new Error("Inventory path escaped release root");
  return createHash("sha256").update(await readFile(full)).digest("hex");
}

function classifyPath(path, kind) {
  if (!path.includes("/") && DEPLOYMENT_METADATA.has(path)) {
    return {
      classification: "deployment_metadata",
      criticality: "low",
      recommendedAction: "retain",
    };
  }

  if (
    path.startsWith(".qa/") ||
    path.startsWith("apps/web/.qa/") ||
    path.includes("/screens/")
  ) {
    return {
      classification: "build_evidence",
      criticality: "low",
      recommendedAction: "retain_or_archive",
    };
  }

  if (
    path.startsWith("apps/web/tests/") ||
    path.startsWith("test/") ||
    path.startsWith("Testing/") ||
    /(^|\/)fixtures\//.test(path)
  ) {
    return {
      classification: "test_fixture",
      criticality: "low",
      recommendedAction: kind === "missing" ? "restore_or_intentionally_retire" : "archive_or_reconcile",
    };
  }

  if (path.startsWith("apps/web/public/") || path.startsWith("public/")) {
    return {
      classification: "public_asset",
      criticality: "medium",
      recommendedAction: kind === "missing" ? "deploy_or_intentionally_exclude" : "reconcile_or_externalize",
    };
  }

  if (
    path.startsWith("apps/web/src/") ||
    path.startsWith("apps/api/src/") ||
    path.startsWith("src/") ||
    path.startsWith("workers/") ||
    path.startsWith("packages/")
  ) {
    return {
      classification: "runtime_source",
      criticality: "high",
      recommendedAction:
        kind === "missing"
          ? "deploy_or_intentionally_exclude"
          : kind === "modified"
            ? "reconcile_patch"
            : "reconcile_to_git",
    };
  }

  if (
    path.startsWith("scripts/") ||
    path.startsWith("deploy/") ||
    path.startsWith("infra/") ||
    path.startsWith(".github/")
  ) {
    return {
      classification: "operations_source",
      criticality: "medium",
      recommendedAction:
        kind === "missing" ? "deploy_or_intentionally_exclude" : "reconcile_to_git",
    };
  }

  if (path.startsWith("docs/")) {
    return {
      classification: "documentation",
      criticality: "low",
      recommendedAction: "reconcile_or_archive",
    };
  }

  return {
    classification: "repository_overlay",
    criticality: "medium",
    recommendedAction:
      kind === "missing" ? "deploy_or_intentionally_exclude" : "review_and_reconcile",
  };
}

async function buildInventory(
  canonicalRoot,
  releaseRoot,
  outputPath,
  commit,
  releaseLabelOverride = null,
) {
  const canonical = await realpath(canonicalRoot);
  const release = await realpath(releaseRoot);
  if (canonical === release) throw new Error("Canonical and release roots must be different");

  const outputAbsolute = resolve(outputPath);
  const outputRelativeToRelease = isInside(release, outputAbsolute)
    ? relative(release, outputAbsolute).split(sep).join("/")
    : null;

  const [canonicalFiles, releaseFiles] = await Promise.all([
    listFiles(canonical),
    listFiles(release),
  ]);

  const canonicalSet = new Set(canonicalFiles);
  const releaseSet = new Set(
    releaseFiles.filter((path) => path !== outputRelativeToRelease),
  );
  const paths = [...new Set([...canonicalSet, ...releaseSet])].sort();
  const entries = [];

  for (const path of paths) {
    const inCanonical = canonicalSet.has(path);
    const inRelease = releaseSet.has(path);
    let kind;

    if (inCanonical && !inRelease) kind = "missing";
    else if (!inCanonical && inRelease) kind = "extra";
    else {
      const [canonicalHash, releaseHash] = await Promise.all([
        hashFile(canonical, path),
        hashFile(release, path),
      ]);
      if (canonicalHash === releaseHash) continue;
      kind = "modified";
    }

    entries.push({
      path,
      kind,
      ...classifyPath(path, kind),
    });
  }

  const count = (predicate) => entries.filter(predicate).length;
  const byClassification = {};
  const byAction = {};
  for (const entry of entries) {
    byClassification[entry.classification] =
      (byClassification[entry.classification] ?? 0) + 1;
    byAction[entry.recommendedAction] =
      (byAction[entry.recommendedAction] ?? 0) + 1;
  }

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    canonicalCommit: commit,
    releaseLabel: releaseLabelOverride || basename(release),
    summary: {
      totalDifferences: entries.length,
      productionOnly: count((entry) => entry.kind === "extra"),
      modifiedCanonical: count((entry) => entry.kind === "modified"),
      missingCanonical: count((entry) => entry.kind === "missing"),
      runtimeReconciliation: count(
        (entry) =>
          entry.classification === "runtime_source" &&
          entry.recommendedAction !== "retain",
      ),
      highCriticality: count((entry) => entry.criticality === "high"),
    },
    byClassification,
    byAction,
    entries,
  };

  await writeFile(outputAbsolute, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return manifest;
}

function gitCommit(cwd) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

const canonicalArg = arg("canonical");
const releaseArg = arg("release");
const outputArg = arg("output");
const commitArg = arg("commit");
const releaseLabelArg = arg("release-label");

if (canonicalArg && releaseArg && outputArg) {
  await stat(canonicalArg);
  await stat(releaseArg);
  const commit = commitArg || gitCommit(canonicalArg);
  const inventory = await buildInventory(
    canonicalArg,
    releaseArg,
    outputArg,
    commit,
    releaseLabelArg,
  );
  console.log(JSON.stringify({
    output: resolve(outputArg),
    canonicalCommit: inventory.canonicalCommit,
    summary: inventory.summary,
    byClassification: inventory.byClassification,
  }));
} else if (process.argv[1]?.endsWith("write-overlay-inventory.mjs")) {
  throw new Error(
    "Usage: node write-overlay-inventory.mjs --canonical <dir> --release <dir> --output <file> [--commit <sha>] [--release-label <name>]",
  );
}

export { buildInventory, classifyPath };
