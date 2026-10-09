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

function hasParentTraversal(path) {
  return path.split("/").some((segment) => segment === "..");
}

function validPolicyPath(path) {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    !path.startsWith("/") &&
    !hasParentTraversal(path) &&
    !/[?*]/.test(path)
  );
}

async function loadPolicy(policyPath, generatedAt) {
  if (!policyPath) {
    return { configured: false, policyId: null, groups: [], byPath: new Map() };
  }

  const value = JSON.parse(await readFile(policyPath, "utf8"));
  if (
    value?.schemaVersion !== 1 ||
    typeof value.policyId !== "string" ||
    value.policyId.trim().length === 0 ||
    typeof value.reviewedAt !== "string" ||
    !Number.isFinite(Date.parse(value.reviewedAt)) ||
    !Array.isArray(value.groups) ||
    value.groups.length > 1000
  ) {
    throw new Error("Release overlay policy schema is invalid");
  }

  const byPath = new Map();
  for (const group of value.groups) {
    if (
      !group ||
      typeof group !== "object" ||
      typeof group.id !== "string" ||
      !/^[a-z0-9][a-z0-9-]{1,79}$/.test(group.id) ||
      typeof group.owner !== "string" ||
      group.owner.trim().length < 3 ||
      typeof group.reason !== "string" ||
      group.reason.trim().length < 20 ||
      typeof group.reviewAfter !== "string" ||
      !Number.isFinite(Date.parse(group.reviewAfter)) ||
      !Array.isArray(group.paths) ||
      group.paths.length === 0 ||
      group.paths.length > 5000
    ) {
      throw new Error("Release overlay policy group is invalid");
    }

    for (const path of group.paths) {
      if (!validPolicyPath(path)) {
        throw new Error("Release overlay policy path is invalid: " + String(path));
      }
      if (byPath.has(path)) {
        throw new Error("Release overlay policy path is duplicated: " + path);
      }
      byPath.set(path, {
        group: group.id,
        owner: group.owner.trim(),
        reason: group.reason.trim(),
        reviewAfter: new Date(group.reviewAfter).toISOString(),
        overdue: Date.parse(group.reviewAfter) < Date.parse(generatedAt),
      });
    }
  }

  return {
    configured: true,
    policyId: value.policyId.trim(),
    reviewedAt: new Date(value.reviewedAt).toISOString(),
    groups: value.groups,
    byPath,
  };
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
      if (
        SKIP_DIRECTORIES.has(entry.name) ||
        entry.name.startsWith(".next.") ||
        entry.name.startsWith(".next-")
      ) continue;
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
  if (
    path === "next-env.d.ts" ||
    path === "tsconfig.tsbuildinfo" ||
    /(?:^|\/)[^/]+\.(?:prev(?:[-.][^/]*)?|bak|backup)(?:$|\.)/i.test(path) ||
    /~$/.test(path)
  ) {
    return {
      classification: "build_evidence",
      criticality: "low",
      recommendedAction: "retain_or_archive",
    };
  }

  if (
    path.split("/").includes("__tests__") ||
    /\.(?:test|spec)\.(?:[cm]?[jt]sx?|d\.ts)$/i.test(path)
  ) {
    return {
      classification: "test_fixture",
      criticality: "low",
      recommendedAction:
        kind === "missing" ? "restore_or_intentionally_retire" : "archive_or_reconcile",
    };
  }

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
  policyPath = null,
) {
  const canonical = await realpath(canonicalRoot);
  const release = await realpath(releaseRoot);
  const generatedAt = new Date().toISOString();
  const policy = await loadPolicy(policyPath, generatedAt);
  const matchedPolicyPaths = new Set();
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
    const [canonicalSha256, releaseSha256] = await Promise.all([
      inCanonical ? hashFile(canonical, path) : Promise.resolve(null),
      inRelease ? hashFile(release, path) : Promise.resolve(null),
    ]);

    let kind;
    if (inCanonical && !inRelease) kind = "missing";
    else if (!inCanonical && inRelease) kind = "extra";
    else {
      if (canonicalSha256 === releaseSha256) continue;
      kind = "modified";
    }

    const classification = classifyPath(path, kind);
    const policyEntry = policy.byPath.get(path) ?? null;
    if (policyEntry) {
      if (kind !== "missing" || classification.classification !== "runtime_source") {
        throw new Error(
          "Release overlay policy may only exclude missing runtime source: " + path,
        );
      }
      matchedPolicyPaths.add(path);
    }

    entries.push({
      path,
      kind,
      canonicalSha256,
      releaseSha256,
      ...classification,
      ...(policyEntry
        ? {
            recommendedAction: policyEntry.overdue
              ? "review_expired_exclusion"
              : "review_intentional_exclusion",
            policyDecision: "intentionally_excluded",
            policyGroup: policyEntry.group,
            policyOwner: policyEntry.owner,
            policyReason: policyEntry.reason,
            policyReviewAfter: policyEntry.reviewAfter,
            policyOverdue: policyEntry.overdue,
          }
        : {}),
    });
  }

  for (const path of policy.byPath.keys()) {
    if (!matchedPolicyPaths.has(path)) {
      throw new Error(
        "Release overlay policy path is not a missing runtime-source difference: " + path,
      );
    }
  }

  const activeExclusion = (entry) =>
    entry.policyDecision === "intentionally_excluded" && entry.policyOverdue === false;
  const overdueExclusion = (entry) =>
    entry.policyDecision === "intentionally_excluded" && entry.policyOverdue === true;
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
    generatedAt,
    canonicalCommit: commit,
    releaseLabel: releaseLabelOverride || basename(release),
    policy: {
      configured: policy.configured,
      policyId: policy.policyId,
      reviewedAt: policy.reviewedAt ?? null,
      groups: policy.groups.length,
      entries: policy.byPath.size,
    },
    summary: {
      totalDifferences: entries.length,
      productionOnly: count((entry) => entry.kind === "extra"),
      modifiedCanonical: count((entry) => entry.kind === "modified"),
      missingCanonical: count((entry) => entry.kind === "missing"),
      runtimeReconciliation: count(
        (entry) =>
          entry.classification === "runtime_source" &&
          !activeExclusion(entry),
      ),
      highCriticality: count(
        (entry) => entry.criticality === "high" && !activeExclusion(entry),
      ),
      intentionalExclusions: count(activeExclusion),
      overdueExclusions: count(overdueExclusion),
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
const policyArg = arg("policy");

if (canonicalArg && releaseArg && outputArg) {
  await stat(canonicalArg);
  await stat(releaseArg);
  let policyPath = policyArg;
  if (!policyPath) {
    const defaultPolicy = resolve(canonicalArg, "release-overlay-policy.json");
    try {
      await stat(defaultPolicy);
      policyPath = defaultPolicy;
    } catch (error) {
      if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error;
    }
  }
  const commit = commitArg || gitCommit(canonicalArg);
  const inventory = await buildInventory(
    canonicalArg,
    releaseArg,
    outputArg,
    commit,
    releaseLabelArg,
    policyPath,
  );
  console.log(JSON.stringify({
    output: resolve(outputArg),
    canonicalCommit: inventory.canonicalCommit,
    summary: inventory.summary,
    byClassification: inventory.byClassification,
  }));
} else if (process.argv[1]?.endsWith("write-overlay-inventory.mjs")) {
  throw new Error(
    "Usage: node write-overlay-inventory.mjs --canonical <dir> --release <dir> --output <file> [--commit <sha>] [--release-label <name>] [--policy <file>]",
  );
}

export { buildInventory, classifyPath, loadPolicy };
