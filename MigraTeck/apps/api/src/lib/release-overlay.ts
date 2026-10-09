import { readFile, realpath } from "node:fs/promises";
import { basename } from "node:path";

export type OverlayKind = "extra" | "modified" | "missing";
export type OverlayClassification =
  | "deployment_metadata"
  | "build_evidence"
  | "test_fixture"
  | "public_asset"
  | "runtime_source"
  | "operations_source"
  | "documentation"
  | "repository_overlay";
export type OverlayCriticality = "low" | "medium" | "high";

export type ReleaseOverlayEntry = {
  path: string;
  kind: OverlayKind;
  classification: OverlayClassification;
  criticality: OverlayCriticality;
  recommendedAction: string;
  policyDecision?: "intentionally_excluded" | undefined;
  policyGroup?: string | undefined;
  policyOwner?: string | undefined;
  policyReason?: string | undefined;
  policyReviewAfter?: string | undefined;
  policyOverdue?: boolean | undefined;
};

type OverlayManifestEntry = ReleaseOverlayEntry & {
  canonicalSha256: string | null;
  releaseSha256: string | null;
};

type OverlayManifest = {
  schemaVersion: 1;
  generatedAt: string;
  canonicalCommit: string;
  releaseLabel: string;
  summary: {
    totalDifferences: number;
    productionOnly: number;
    modifiedCanonical: number;
    missingCanonical: number;
    runtimeReconciliation: number;
    highCriticality: number;
    intentionalExclusions: number;
    overdueExclusions: number;
  };
  byClassification: Record<string, number>;
  byAction: Record<string, number>;
  entries: OverlayManifestEntry[];
};

export type ReleaseOverlayState = "managed" | "missing" | "invalid";

export type ReleaseOverlaySnapshot = {
  state: ReleaseOverlayState;
  generatedAt: string | null;
  canonicalCommit: string | null;
  releaseLabel: string | null;
  installedReleaseLabel: string | null;
  summary: OverlayManifest["summary"];
  byClassification: Record<string, number>;
  byAction: Record<string, number>;
  samples: ReleaseOverlayEntry[];
  detail: string;
};

const EMPTY_SUMMARY: OverlayManifest["summary"] = {
  totalDifferences: 0,
  productionOnly: 0,
  modifiedCanonical: 0,
  missingCanonical: 0,
  runtimeReconciliation: 0,
  highCriticality: 0,
  intentionalExclusions: 0,
  overdueExclusions: 0,
};

const CACHE_MS = 60_000;
let cached:
  | {
      at: number;
      manifest: OverlayManifest;
      snapshot: ReleaseOverlaySnapshot;
    }
  | null = null;

function inventoryPath() {
  return (
    process.env.MIGRATECK_WEB_OVERLAY_INVENTORY ??
    "/opt/migra/apps/migrateck/current/OVERLAY_INVENTORY.json"
  );
}

function installedReleaseRoot() {
  return (
    process.env.MIGRATECK_WEB_RELEASE_CONTAINER_ROOT ??
    "/opt/migra/apps/migrateck/current"
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function validSha256(value: unknown) {
  return value === null || (typeof value === "string" && /^[a-f0-9]{64}$/i.test(value));
}

function hasParentTraversal(path: string) {
  return path.split("/").some((segment) => segment === "..");
}

function validPolicyMetadata(entry: Partial<OverlayManifestEntry>) {
  const hasPolicy = entry.policyDecision !== undefined;
  if (!hasPolicy) {
    return (
      entry.policyGroup === undefined &&
      entry.policyOwner === undefined &&
      entry.policyReason === undefined &&
      entry.policyReviewAfter === undefined &&
      entry.policyOverdue === undefined
    );
  }

  return (
    entry.policyDecision === "intentionally_excluded" &&
    entry.kind === "missing" &&
    entry.classification === "runtime_source" &&
    typeof entry.policyGroup === "string" &&
    entry.policyGroup.length > 0 &&
    typeof entry.policyOwner === "string" &&
    entry.policyOwner.length > 0 &&
    typeof entry.policyReason === "string" &&
    entry.policyReason.length > 0 &&
    typeof entry.policyReviewAfter === "string" &&
    Number.isFinite(new Date(entry.policyReviewAfter).getTime()) &&
    typeof entry.policyOverdue === "boolean"
  );
}

function validateEntry(value: unknown): value is OverlayManifestEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<OverlayManifestEntry>;
  return (
    typeof entry.path === "string" &&
    entry.path.length > 0 &&
    !entry.path.startsWith("/") &&
    !hasParentTraversal(entry.path) &&
    ["extra", "modified", "missing"].includes(entry.kind ?? "") &&
    [
      "deployment_metadata",
      "build_evidence",
      "test_fixture",
      "public_asset",
      "runtime_source",
      "operations_source",
      "documentation",
      "repository_overlay",
    ].includes(entry.classification ?? "") &&
    ["low", "medium", "high"].includes(entry.criticality ?? "") &&
    typeof entry.recommendedAction === "string" &&
    entry.recommendedAction.length > 0 &&
    validSha256(entry.canonicalSha256) &&
    validSha256(entry.releaseSha256) &&
    validPolicyMetadata(entry)
  );
}

function publicEntry(entry: OverlayManifestEntry): ReleaseOverlayEntry {
  return {
    path: entry.path,
    kind: entry.kind,
    classification: entry.classification,
    criticality: entry.criticality,
    recommendedAction: entry.recommendedAction,
    ...(entry.policyDecision
      ? {
          policyDecision: entry.policyDecision,
          policyGroup: entry.policyGroup,
          policyOwner: entry.policyOwner,
          policyReason: entry.policyReason,
          policyReviewAfter: entry.policyReviewAfter,
          policyOverdue: entry.policyOverdue,
        }
      : {}),
  };
}

function parseManifest(raw: string): OverlayManifest {
  const value = JSON.parse(raw) as Partial<OverlayManifest>;
  const summary = value.summary as Partial<OverlayManifest["summary"]> | undefined;

  const intentionalExclusions = summary?.intentionalExclusions ?? 0;
  const overdueExclusions = summary?.overdueExclusions ?? 0;

  if (
    value.schemaVersion !== 1 ||
    typeof value.generatedAt !== "string" ||
    !Number.isFinite(new Date(value.generatedAt).getTime()) ||
    typeof value.canonicalCommit !== "string" ||
    value.canonicalCommit.length === 0 ||
    typeof value.releaseLabel !== "string" ||
    value.releaseLabel.length === 0 ||
    !summary ||
    !isNonNegativeInteger(summary.totalDifferences) ||
    !isNonNegativeInteger(summary.productionOnly) ||
    !isNonNegativeInteger(summary.modifiedCanonical) ||
    !isNonNegativeInteger(summary.missingCanonical) ||
    !isNonNegativeInteger(summary.runtimeReconciliation) ||
    !isNonNegativeInteger(summary.highCriticality) ||
    !isNonNegativeInteger(intentionalExclusions) ||
    !isNonNegativeInteger(overdueExclusions) ||
    !value.byClassification ||
    typeof value.byClassification !== "object" ||
    !value.byAction ||
    typeof value.byAction !== "object" ||
    !Array.isArray(value.entries) ||
    value.entries.length > 50_000 ||
    !value.entries.every(validateEntry)
  ) {
    throw new Error("Release overlay inventory schema is invalid");
  }

  if (value.entries.length !== summary.totalDifferences) {
    throw new Error("Release overlay inventory totals do not match entries");
  }

  const policyEntries = value.entries.filter(
    (entry) => entry.policyDecision === "intentionally_excluded",
  );
  const activePolicyEntries = policyEntries.filter(
    (entry) => entry.policyOverdue === false,
  );
  const overduePolicyEntries = policyEntries.filter(
    (entry) => entry.policyOverdue === true,
  );
  if (
    activePolicyEntries.length !== intentionalExclusions ||
    overduePolicyEntries.length !== overdueExclusions
  ) {
    throw new Error("Release overlay policy totals do not match entries");
  }

  return {
    ...value,
    summary: {
      ...(summary as OverlayManifest["summary"]),
      intentionalExclusions,
      overdueExclusions,
    },
  } as OverlayManifest;
}

function samples(entries: OverlayManifestEntry[]) {
  return [...entries]
    .sort((a, b) => {
      const rank = { high: 0, medium: 1, low: 2 };
      return (
        rank[a.criticality] - rank[b.criticality] ||
        a.classification.localeCompare(b.classification) ||
        a.path.localeCompare(b.path)
      );
    })
    .slice(0, 16)
    .map(publicEntry);
}

async function loadManifest(): Promise<{
  manifest: OverlayManifest;
  installedReleaseLabel: string | null;
}> {
  const path = inventoryPath();
  const raw = await readFile(path, "utf8");
  const manifest = parseManifest(raw);

  let installedReleaseLabel: string | null = null;
  try {
    installedReleaseLabel = basename(await realpath(installedReleaseRoot()));
  } catch {
    installedReleaseLabel = null;
  }

  if (
    installedReleaseLabel &&
    manifest.releaseLabel !== installedReleaseLabel
  ) {
    throw new Error(
      "Release overlay inventory belongs to a different installed release",
    );
  }

  return { manifest, installedReleaseLabel };
}

export async function getReleaseOverlaySnapshot(
  force = false,
): Promise<ReleaseOverlaySnapshot> {
  const now = Date.now();
  if (!force && cached && now - cached.at < CACHE_MS) {
    return cached.snapshot;
  }

  try {
    const { manifest, installedReleaseLabel } = await loadManifest();
    const snapshot: ReleaseOverlaySnapshot = {
      state: "managed",
      generatedAt: manifest.generatedAt,
      canonicalCommit: manifest.canonicalCommit,
      releaseLabel: manifest.releaseLabel,
      installedReleaseLabel,
      summary: manifest.summary,
      byClassification: manifest.byClassification,
      byAction: manifest.byAction,
      samples: samples(manifest.entries),
      detail:
        manifest.summary.runtimeReconciliation > 0
          ? "Production overlay is inventoried; unresolved runtime-source differences require deliberate reconciliation. Time-bounded intentional exclusions remain visible separately and are never auto-deleted."
          : manifest.summary.intentionalExclusions > 0
            ? "Production overlay is inventoried with " +
              manifest.summary.intentionalExclusions +
              " time-bounded intentional exclusion" +
              (manifest.summary.intentionalExclusions === 1 ? "" : "s") +
              " and no unresolved runtime-source reconciliation debt."
            : "Production overlay is inventoried and has no runtime-source reconciliation debt.",
    };

    cached = { at: now, manifest, snapshot };
    return snapshot;
  } catch (error) {
    const missing =
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT";

    return {
      state: missing ? "missing" : "invalid",
      generatedAt: null,
      canonicalCommit: null,
      releaseLabel: null,
      installedReleaseLabel: null,
      summary: EMPTY_SUMMARY,
      byClassification: {},
      byAction: {},
      samples: [],
      detail: missing
        ? "No release overlay inventory is installed. Production-only source cannot be reconciled safely until an inventory is generated."
        : error instanceof Error
          ? error.message
          : "Release overlay inventory could not be validated.",
    };
  }
}

export async function listReleaseOverlayEntries(input: {
  kind?: OverlayKind | undefined;
  classification?: OverlayClassification | undefined;
  action?: string | undefined;
  offset?: number | undefined;
  limit?: number | undefined;
}) {
  const now = Date.now();
  if (!cached || now - cached.at >= CACHE_MS) {
    await getReleaseOverlaySnapshot(true);
  }

  if (!cached) {
    return {
      state: "missing" as const,
      total: 0,
      offset: 0,
      limit: Math.min(Math.max(input.limit ?? 100, 1), 500),
      entries: [] as ReleaseOverlayEntry[],
    };
  }

  const filtered = cached.manifest.entries.filter(
    (entry) =>
      (!input.kind || entry.kind === input.kind) &&
      (!input.classification ||
        entry.classification === input.classification) &&
      (!input.action || entry.recommendedAction === input.action),
  );
  const offset = Math.max(input.offset ?? 0, 0);
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);

  return {
    state: "managed" as const,
    total: filtered.length,
    offset,
    limit,
    entries: filtered.slice(offset, offset + limit).map(publicEntry),
  };
}
