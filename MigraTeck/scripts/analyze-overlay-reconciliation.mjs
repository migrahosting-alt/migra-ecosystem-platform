import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

function arg(name, fallback = null) {
  const index = process.argv.indexOf("--" + name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes("--" + name);
}

function isInside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + sep));
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function hasParentTraversal(path) {
  return path.split("/").some((segment) => segment === "..");
}

async function hashWorkspaceFile(workspaceRoot, rel) {
  const full = resolve(workspaceRoot, rel);
  if (!isInside(workspaceRoot, full)) {
    throw new Error("Workspace reconciliation path escaped its allowed root");
  }

  try {
    const info = await stat(full);
    if (!info.isFile()) return null;
    const bytes = await readFile(full);
    return createHash("sha256").update(bytes).digest("hex");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    throw error;
  }
}

function hashHeadFile(gitRoot, gitPrefix, rel) {
  if (!gitRoot) return null;
  const normalizedPrefix = (gitPrefix || "").replace(/^\/+|\/+$/g, "");
  const gitPath = [normalizedPrefix, rel].filter(Boolean).join("/");
  try {
    // cat-file resolves the rev:path as one literal object expression.
    // git show on an absent Next.js dynamic-route path can yield an empty
    // successful result, which then looks like a committed empty file.
    // Fail closed instead: an absent blob must return null.
    const bytes = execFileSync("git", ["cat-file", "blob", "HEAD:" + gitPath], {
      cwd: gitRoot,
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
    return createHash("sha256").update(bytes).digest("hex");
  } catch {
    return null;
  }
}

export function classifyReconciliation(entry, workspaceSha256, headSha256) {
  const canonical = entry.canonicalSha256 ?? null;
  const release = entry.releaseSha256 ?? null;

  if (
    (canonical !== null && !isSha256(canonical)) ||
    (release !== null && !isSha256(release)) ||
    (entry.kind === "missing" && !canonical) ||
    (entry.kind === "extra" && !release) ||
    (entry.kind === "modified" && (!canonical || !release))
  ) {
    return {
      category: "inventory_missing_fingerprints",
      blocking: true,
      detail: "The installed overlay inventory predates fingerprinted reconciliation and must be regenerated.",
    };
  }

  if (entry.kind === "missing") {
    if (!workspaceSha256) {
      return {
        category: "workspace_missing_candidate_file",
        blocking: true,
        detail: "Canonical source is absent from the installed release and from the current workspace.",
      };
    }
    if (headSha256 && workspaceSha256 === headSha256) {
      return {
        category: "committed_pending_deploy",
        blocking: false,
        detail: "Candidate source is committed and simply has not reached the installed release yet.",
      };
    }
    return {
      category: "pending_deploy_with_local_changes",
      blocking: true,
      detail: "Candidate source is absent from production but differs from the committed candidate.",
    };
  }

  if (entry.kind === "extra") {
    if (!workspaceSha256) {
      return {
        category: "production_only_not_in_workspace",
        blocking: true,
        detail: "Production contains runtime source that is absent from both the old canonical inventory and the workspace.",
      };
    }
    if (workspaceSha256 === release) {
      if (headSha256 && headSha256 === workspaceSha256) {
        return {
          category: "production_extra_committed",
          blocking: false,
          detail: "Production-only source has been recovered and committed into the candidate.",
        };
      }
      return {
        category: "production_extra_recovered_uncommitted",
        blocking: true,
        detail: "Production-only source is recovered locally but is not committed into the candidate.",
      };
    }
    return {
      category: "production_extra_workspace_diverged",
      blocking: true,
      detail: "Production-only source exists locally but the workspace version differs from production.",
    };
  }

  if (!workspaceSha256) {
    return {
      category: "workspace_missing_modified_file",
      blocking: true,
      detail: "A production-modified canonical file is missing from the workspace.",
    };
  }

  if (workspaceSha256 === release) {
    if (headSha256 && headSha256 === workspaceSha256) {
      return {
        category: "production_patch_committed",
        blocking: false,
        detail: "The production patch has been recovered and committed into the candidate.",
      };
    }
    return {
      category: "production_patch_recovered_uncommitted",
      blocking: true,
      detail: "The production patch is recovered locally but is not committed into the candidate.",
    };
  }

  if (headSha256 && workspaceSha256 === headSha256) {
    if (headSha256 === canonical) {
      return {
        category: "production_patch_not_recovered",
        blocking: true,
        detail: "The candidate still matches the old canonical file while production contains a different patch.",
      };
    }
    return {
      category: "committed_three_way_divergence",
      blocking: true,
      detail: "The committed candidate and production both moved away from the inventory baseline in different ways.",
    };
  }

  if (workspaceSha256 === canonical) {
    return {
      category: "production_patch_not_recovered",
      blocking: true,
      detail: "The workspace still matches the old canonical file while production contains a different patch.",
    };
  }

  return {
    category: "three_way_divergence",
    blocking: true,
    detail: "Inventory baseline, production, and workspace contain three distinct runtime versions.",
  };
}

export async function analyzeOverlayReconciliation({
  inventoryPath,
  workspaceRoot,
  gitRoot = null,
  gitPrefix = "",
  classification = "runtime_source",
  sampleLimit = 12,
}) {
  const [inventoryRaw, workspace] = await Promise.all([
    readFile(inventoryPath, "utf8"),
    realpath(workspaceRoot),
  ]);
  const inventory = JSON.parse(inventoryRaw);

  if (inventory?.schemaVersion !== 1 || !Array.isArray(inventory.entries)) {
    throw new Error("Overlay inventory schema is invalid");
  }

  const gitCanonical = gitRoot ? await realpath(gitRoot) : null;
  const entries = [];
  const counts = {};
  const blockers = {};

  for (const entry of inventory.entries) {
    if (!entry || typeof entry !== "object") continue;
    if (classification && entry.classification !== classification) continue;
    if (
      typeof entry.path !== "string" ||
      entry.path.startsWith("/") ||
      hasParentTraversal(entry.path)
    ) {
      throw new Error("Overlay inventory contains an unsafe path");
    }

    const workspaceSha256 = await hashWorkspaceFile(workspace, entry.path);
    const headSha256 = hashHeadFile(gitCanonical, gitPrefix, entry.path);
    const result = classifyReconciliation(entry, workspaceSha256, headSha256);
    counts[result.category] = (counts[result.category] ?? 0) + 1;
    if (result.blocking) blockers[result.category] = (blockers[result.category] ?? 0) + 1;

    entries.push({
      path: entry.path,
      kind: entry.kind,
      classification: entry.classification,
      criticality: entry.criticality,
      category: result.category,
      blocking: result.blocking,
      detail: result.detail,
    });
  }

  const blockingCount = entries.filter((entry) => entry.blocking).length;
  const samples = {};
  for (const entry of entries) {
    if (!samples[entry.category]) samples[entry.category] = [];
    if (samples[entry.category].length < sampleLimit) {
      samples[entry.category].push({
        path: entry.path,
        kind: entry.kind,
        blocking: entry.blocking,
      });
    }
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    inventory: {
      generatedAt: inventory.generatedAt ?? null,
      canonicalCommit: inventory.canonicalCommit ?? null,
      releaseLabel: inventory.releaseLabel ?? null,
    },
    scope: classification || "all",
    summary: {
      total: entries.length,
      blocking: blockingCount,
      nonBlocking: entries.length - blockingCount,
      cutoverSafe: blockingCount === 0,
    },
    counts,
    blockers,
    samples,
    entries,
  };
}

const inventoryArg = arg("inventory");
const workspaceArg = arg("workspace");
const gitRootArg = arg("git-root");
const gitPrefixArg = arg("git-prefix", "");
const classificationArg = arg("classification", "runtime_source");
const outputArg = arg("output");
const sampleLimitArg = Number(arg("sample-limit", "12"));

if (inventoryArg && workspaceArg) {
  const report = await analyzeOverlayReconciliation({
    inventoryPath: inventoryArg,
    workspaceRoot: workspaceArg,
    gitRoot: gitRootArg,
    gitPrefix: gitPrefixArg,
    classification: classificationArg === "all" ? null : classificationArg,
    sampleLimit: Number.isFinite(sampleLimitArg) ? Math.max(1, Math.min(sampleLimitArg, 100)) : 12,
  });

  if (outputArg) {
    await writeFile(resolve(outputArg), JSON.stringify(report, null, 2) + "\n", "utf8");
  }

  console.log(JSON.stringify({
    inventory: report.inventory,
    scope: report.scope,
    summary: report.summary,
    counts: report.counts,
    blockers: report.blockers,
    samples: report.samples,
    output: outputArg ? resolve(outputArg) : null,
  }, null, 2));

  if (hasFlag("fail-on-blockers") && !report.summary.cutoverSafe) {
    process.exitCode = 20;
  }
} else if (process.argv[1]?.endsWith("analyze-overlay-reconciliation.mjs")) {
  throw new Error(
    "Usage: node analyze-overlay-reconciliation.mjs --inventory <file> --workspace <dir> [--git-root <repo>] [--git-prefix <path>] [--classification runtime_source|all] [--output <file>] [--fail-on-blockers]",
  );
}
