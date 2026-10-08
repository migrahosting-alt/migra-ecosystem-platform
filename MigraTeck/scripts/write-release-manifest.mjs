import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";

function arg(name, fallback = null) {
  const index = process.argv.indexOf("--" + name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function isInside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(".." + sep) && rel !== ".." && !rel.startsWith(".."));
}

async function listFiles(root, prefix = "") {
  const directory = resolve(root, prefix);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? prefix + "/" + entry.name : entry.name;
    if (entry.isDirectory()) {
      if (["node_modules", ".git", "cache"].includes(entry.name)) continue;
      files.push(...await listFiles(root, rel));
      continue;
    }
    if (entry.isFile()) files.push(rel);
  }
  return files;
}

async function hashTree(root, excludedRelativePaths = new Set()) {
  const canonicalRoot = await realpath(root);
  const files = await listFiles(canonicalRoot);
  const digest = createHash("sha256");

  for (const rel of files) {
    if (excludedRelativePaths.has(rel)) continue;
    const full = resolve(canonicalRoot, rel);
    if (!isInside(canonicalRoot, full)) {
      throw new Error("Refusing to hash path outside release root: " + rel);
    }
    const bytes = await readFile(full);
    const fileHash = createHash("sha256").update(bytes).digest("hex");
    digest.update(rel);
    digest.update("\0");
    digest.update(fileHash);
    digest.update("\n");
  }

  return digest.digest("hex");
}

function gitValue(args, fallback) {
  try {
    return execFileSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || fallback;
  } catch {
    return fallback;
  }
}

const service = arg("service");
const source = arg("source");
const artifact = arg("artifact");
const output = arg("output");
const kind = arg("kind", "build");
const commitOverride = arg("commit");
const dirtyOverride = arg("dirty");

if (!service || !source || !artifact || !output) {
  throw new Error(
    "Usage: node write-release-manifest.mjs --service <name> --source <dir> --artifact <dir> --output <file>",
  );
}

const outputPath = resolve(process.cwd(), output);
const outputDir = dirname(outputPath);
const sourcePath = resolve(process.cwd(), source);
const artifactPath = resolve(process.cwd(), artifact);

await stat(sourcePath);
await stat(artifactPath);

const sourceRoot = relative(outputDir, sourcePath) || ".";
const artifactRoot = relative(outputDir, artifactPath) || ".";
const outputInsideArtifact = isInside(artifactPath, outputPath)
  ? relative(artifactPath, outputPath).split(sep).join("/")
  : null;

const sourceHash = await hashTree(sourcePath);
const artifactHash = await hashTree(
  artifactPath,
  outputInsideArtifact ? new Set([outputInsideArtifact]) : new Set(),
);

if (!["build", "baseline"].includes(kind)) {
  throw new Error("Release manifest kind must be build or baseline");
}

const commit = commitOverride ||
  process.env.MIGRATECK_BUILD_COMMIT?.trim() ||
  gitValue(["rev-parse", "HEAD"], "unknown");
const dirty = dirtyOverride !== null
  ? dirtyOverride === "true"
  : kind === "baseline"
    ? true
    : gitValue(["status", "--porcelain", "--", "."], "") !== "";

const manifest = {
  schemaVersion: 1,
  kind,
  service,
  commit,
  dirty,
  builtAt: new Date().toISOString(),
  sourceRoot,
  artifactRoot,
  sourceSha256: sourceHash,
  artifactSha256: artifactHash,
};

await writeFile(outputPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(JSON.stringify({
  service,
  kind,
  commit,
  dirty,
  output: outputPath,
  sourceSha256: sourceHash,
  artifactSha256: artifactHash,
}));
