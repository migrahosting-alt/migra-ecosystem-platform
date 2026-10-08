import { createHash } from "node:crypto";
import { readdir, readFile, realpath } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

export type ReleaseIntegrityState =
  | "verified"
  | "drift"
  | "missing"
  | "invalid";

type ReleaseManifest = {
  schemaVersion: 1;
  kind: "build" | "baseline";
  service: string;
  commit: string;
  dirty: boolean;
  builtAt: string;
  sourceRoot: string;
  artifactRoot: string;
  sourceSha256: string;
  artifactSha256: string;
};

export type ReleaseIntegrity = {
  key: "platform_api" | "platform_web";
  label: string;
  state: ReleaseIntegrityState;
  service: string | null;
  kind: "build" | "baseline" | null;
  commit: string | null;
  dirty: boolean | null;
  builtAt: string | null;
  manifestPath: string;
  deploymentPath: string | null;
  sourceMatches: boolean | null;
  artifactMatches: boolean | null;
  expectedSourceSha256: string | null;
  actualSourceSha256: string | null;
  expectedArtifactSha256: string | null;
  actualArtifactSha256: string | null;
  detail: string;
};

type ReleaseSpec = {
  key: ReleaseIntegrity["key"];
  label: string;
  manifestPath: string;
  allowedRoot: string;
  deploymentRoot?: string;
};

const CACHE_MS = 60_000;
let cached:
  | {
      at: number;
      value: ReleaseIntegrity[];
    }
  | null = null;

function isInside(root: string, candidate: string) {
  const rel = relative(root, candidate);
  return (
    rel === "" ||
    (rel !== ".." &&
      !rel.startsWith(".." + sep) &&
      !rel.startsWith("../"))
  );
}

async function listFiles(root: string, prefix = ""): Promise<string[]> {
  const directory = resolve(root, prefix);
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? prefix + "/" + entry.name : entry.name;
    if (entry.isDirectory()) {
      if (["node_modules", ".git", "cache"].includes(entry.name)) continue;
      files.push(...(await listFiles(root, rel)));
      continue;
    }
    if (entry.isFile()) files.push(rel);
  }

  return files;
}

export async function hashReleaseTree(
  root: string,
  excludedRelativePaths = new Set<string>(),
): Promise<string> {
  const canonicalRoot = await realpath(root);
  const files = await listFiles(canonicalRoot);
  const digest = createHash("sha256");

  for (const rel of files) {
    if (excludedRelativePaths.has(rel)) continue;

    const full = resolve(canonicalRoot, rel);
    if (!isInside(canonicalRoot, full)) {
      throw new Error("Release hash escaped its allowed root");
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

function parseManifest(raw: string): ReleaseManifest {
  const value = JSON.parse(raw) as Partial<ReleaseManifest>;
  if (
    value.schemaVersion !== 1 ||
    !["build", "baseline"].includes(value.kind ?? "") ||
    typeof value.service !== "string" ||
    typeof value.commit !== "string" ||
    typeof value.dirty !== "boolean" ||
    typeof value.builtAt !== "string" ||
    typeof value.sourceRoot !== "string" ||
    typeof value.artifactRoot !== "string" ||
    !/^[a-f0-9]{64}$/i.test(value.sourceSha256 ?? "") ||
    !/^[a-f0-9]{64}$/i.test(value.artifactSha256 ?? "")
  ) {
    throw new Error("Release manifest schema is invalid");
  }

  return value as ReleaseManifest;
}

async function verifyRelease(spec: ReleaseSpec): Promise<ReleaseIntegrity> {
  let deploymentPath: string | null = null;
  try {
    if (spec.deploymentRoot) {
      deploymentPath = await realpath(spec.deploymentRoot);
    }
  } catch {
    deploymentPath = spec.deploymentRoot ?? null;
  }

  let raw: string;
  try {
    raw = await readFile(spec.manifestPath, "utf8");
  } catch {
    return {
      key: spec.key,
      label: spec.label,
      state: "missing",
      service: null,
      kind: null,
      commit: null,
      dirty: null,
      builtAt: null,
      manifestPath: spec.manifestPath,
      deploymentPath,
      sourceMatches: null,
      artifactMatches: null,
      expectedSourceSha256: null,
      actualSourceSha256: null,
      expectedArtifactSha256: null,
      actualArtifactSha256: null,
      detail: "No release manifest is installed for this runtime.",
    };
  }

  try {
    const manifest = parseManifest(raw);
    const manifestPath = await realpath(spec.manifestPath);
    const manifestDir = dirname(manifestPath);
    const allowedRoot = await realpath(spec.allowedRoot);
    const sourceRoot = await realpath(resolve(manifestDir, manifest.sourceRoot));
    const artifactRoot = await realpath(resolve(manifestDir, manifest.artifactRoot));

    if (!isInside(allowedRoot, sourceRoot) || !isInside(allowedRoot, artifactRoot)) {
      throw new Error("Release manifest root escaped the allowed service directory");
    }

    const outputInsideArtifact = isInside(artifactRoot, manifestPath)
      ? relative(artifactRoot, manifestPath).split(sep).join("/")
      : null;

    const [actualSourceSha256, actualArtifactSha256] = await Promise.all([
      hashReleaseTree(sourceRoot),
      hashReleaseTree(
        artifactRoot,
        outputInsideArtifact ? new Set([outputInsideArtifact]) : new Set(),
      ),
    ]);

    const sourceMatches =
      actualSourceSha256.toLowerCase() === manifest.sourceSha256.toLowerCase();
    const artifactMatches =
      actualArtifactSha256.toLowerCase() === manifest.artifactSha256.toLowerCase();

    return {
      key: spec.key,
      label: spec.label,
      state: sourceMatches && artifactMatches ? "verified" : "drift",
      service: manifest.service,
      kind: manifest.kind,
      commit: manifest.commit,
      dirty: manifest.dirty,
      builtAt: manifest.builtAt,
      manifestPath: spec.manifestPath,
      deploymentPath,
      sourceMatches,
      artifactMatches,
      expectedSourceSha256: manifest.sourceSha256,
      actualSourceSha256,
      expectedArtifactSha256: manifest.artifactSha256,
      actualArtifactSha256,
      detail:
        sourceMatches && artifactMatches
          ? "Source and compiled artifact fingerprints match the installed build manifest."
          : [
              !sourceMatches ? "source fingerprint differs" : null,
              !artifactMatches ? "compiled artifact fingerprint differs" : null,
            ]
              .filter(Boolean)
              .join("; "),
    };
  } catch (error) {
    return {
      key: spec.key,
      label: spec.label,
      state: "invalid",
      service: null,
      kind: null,
      commit: null,
      dirty: null,
      builtAt: null,
      manifestPath: spec.manifestPath,
      deploymentPath,
      sourceMatches: null,
      artifactMatches: null,
      expectedSourceSha256: null,
      actualSourceSha256: null,
      expectedArtifactSha256: null,
      actualArtifactSha256: null,
      detail:
        error instanceof Error ? error.message : "Release manifest validation failed.",
    };
  }
}

function releaseSpecs(): ReleaseSpec[] {
  const apiRoot =
    process.env.MIGRATECK_PLATFORM_API_ROOT ??
    process.cwd();
  const webRoot =
    process.env.MIGRATECK_WEB_RELEASE_ROOT ??
    "/opt/migra/apps/migrateck/current/apps/web";

  return [
    {
      key: "platform_api",
      label: "Platform API",
      manifestPath:
        process.env.MIGRATECK_PLATFORM_API_RELEASE_MANIFEST ??
        resolve(apiRoot, "dist/release-manifest.json"),
      allowedRoot: apiRoot,
      deploymentRoot: apiRoot,
    },
    {
      key: "platform_web",
      label: "Platform web",
      manifestPath:
        process.env.MIGRATECK_WEB_RELEASE_MANIFEST ??
        resolve(webRoot, ".next/release-manifest.json"),
      allowedRoot: webRoot,
      deploymentRoot: webRoot,
    },
  ];
}

export async function getReleaseIntegritySnapshot(
  force = false,
): Promise<ReleaseIntegrity[]> {
  const now = Date.now();
  if (!force && cached && now - cached.at < CACHE_MS) return cached.value;

  const value = await Promise.all(releaseSpecs().map(verifyRelease));
  cached = { at: now, value };
  return value;
}
