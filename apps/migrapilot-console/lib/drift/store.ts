import fs from "node:fs";
import path from "node:path";

import { readJsonArtifact, writeJsonArtifact } from "../server/artifact-storage";
import { stableStringify } from "./normalize";
import type {
  DriftDiffRecord,
  DriftIndex,
  DriftSnapshot,
  DriftSnapshotMeta
} from "./types";

const driftRoot = path.resolve(process.cwd(), ".data", "drift");
const snapshotsDir = path.join(driftRoot, "snapshots");
const diffsDir = path.join(driftRoot, "diffs");
const indexPath = path.join(driftRoot, "index.json");
const driftArtifactCategory = "drift";

function defaultIndex(): DriftIndex {
  return {
    snapshots: [],
    diffs: []
  };
}

function ensureStorage(): void {
  fs.mkdirSync(snapshotsDir, { recursive: true });
  fs.mkdirSync(diffsDir, { recursive: true });
  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(indexPath, stableStringify(defaultIndex()), "utf8");
  }
}

function snapshotArtifactPath(snapshotId: string): string {
  return `snapshots/${snapshotId}.json`;
}

function diffArtifactPath(diffId: string): string {
  return `diffs/${diffId}.json`;
}

function parseDriftIndex(value: DriftIndex | null | undefined): DriftIndex {
  return {
    snapshots: Array.isArray(value?.snapshots) ? value.snapshots : [],
    diffs: Array.isArray(value?.diffs) ? value.diffs : []
  };
}

async function bestEffortArtifactWrite(
  relativePath: string,
  data: unknown,
  metadata?: Record<string, string | number | boolean | null | undefined>
) {
  try {
    await writeJsonArtifact({
      category: driftArtifactCategory,
      relativePath,
      data,
      metadata
    });
  } catch (error) {
    console.warn(`[migrapilot] failed to mirror drift artifact ${relativePath}:`, (error as Error).message);
  }
}

export async function readDriftIndex(): Promise<DriftIndex> {
  ensureStorage();
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, "utf8")) as DriftIndex;
    return parseDriftIndex(parsed);
  } catch {
    const remote = await readJsonArtifact<DriftIndex>({
      category: driftArtifactCategory,
      relativePath: "index.json"
    });
    if (remote) {
      const parsed = parseDriftIndex(remote);
      fs.writeFileSync(indexPath, stableStringify(parsed), "utf8");
      return parsed;
    }
    return parseDriftIndex(defaultIndex());
  }
}

export async function writeDriftIndex(index: DriftIndex): Promise<void> {
  ensureStorage();
  fs.writeFileSync(indexPath, stableStringify(index), "utf8");
  await bestEffortArtifactWrite("index.json", index, { artifact: "index" });
}

export async function writeSnapshot(snapshot: DriftSnapshot): Promise<void> {
  ensureStorage();
  const snapshotPath = path.join(snapshotsDir, `${snapshot.snapshotId}.json`);
  fs.writeFileSync(snapshotPath, stableStringify(snapshot), "utf8");
  await bestEffortArtifactWrite(snapshotArtifactPath(snapshot.snapshotId), snapshot, {
    artifact: "snapshot",
    snapshotid: snapshot.snapshotId,
    environment: snapshot.environment,
    classification: snapshot.classification
  });
}

export async function readSnapshot(snapshotId: string): Promise<DriftSnapshot | null> {
  ensureStorage();
  const snapshotPath = path.join(snapshotsDir, `${snapshotId}.json`);
  if (!fs.existsSync(snapshotPath)) {
    const remote = await readJsonArtifact<DriftSnapshot>({
      category: driftArtifactCategory,
      relativePath: snapshotArtifactPath(snapshotId)
    });
    if (!remote) {
      return null;
    }
    fs.writeFileSync(snapshotPath, stableStringify(remote), "utf8");
    return remote;
  }
  try {
    return JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as DriftSnapshot;
  } catch {
    const remote = await readJsonArtifact<DriftSnapshot>({
      category: driftArtifactCategory,
      relativePath: snapshotArtifactPath(snapshotId)
    });
    if (!remote) {
      return null;
    }
    fs.writeFileSync(snapshotPath, stableStringify(remote), "utf8");
    return remote;
  }
}

export async function writeDiff(diffRecord: DriftDiffRecord): Promise<void> {
  ensureStorage();
  const diffPath = path.join(diffsDir, `${diffRecord.diffId}.json`);
  fs.writeFileSync(diffPath, stableStringify(diffRecord), "utf8");
  await bestEffortArtifactWrite(diffArtifactPath(diffRecord.diffId), diffRecord, {
    artifact: "diff",
    diffid: diffRecord.diffId,
    fromsnapshotid: diffRecord.fromSnapshotId,
    tosnapshotid: diffRecord.toSnapshotId
  });
}

export async function readDiffById(diffId: string): Promise<DriftDiffRecord | null> {
  ensureStorage();
  const diffPath = path.join(diffsDir, `${diffId}.json`);
  if (!fs.existsSync(diffPath)) {
    const remote = await readJsonArtifact<DriftDiffRecord>({
      category: driftArtifactCategory,
      relativePath: diffArtifactPath(diffId)
    });
    if (!remote) {
      return null;
    }
    fs.writeFileSync(diffPath, stableStringify(remote), "utf8");
    return remote;
  }
  try {
    return JSON.parse(fs.readFileSync(diffPath, "utf8")) as DriftDiffRecord;
  } catch {
    const remote = await readJsonArtifact<DriftDiffRecord>({
      category: driftArtifactCategory,
      relativePath: diffArtifactPath(diffId)
    });
    if (!remote) {
      return null;
    }
    fs.writeFileSync(diffPath, stableStringify(remote), "utf8");
    return remote;
  }
}

export async function saveSnapshotMeta(meta: DriftSnapshotMeta): Promise<void> {
  const index = await readDriftIndex();
  const existingIndex = index.snapshots.findIndex((entry) => entry.snapshotId === meta.snapshotId);
  if (existingIndex >= 0) {
    index.snapshots[existingIndex] = meta;
  } else {
    index.snapshots.unshift(meta);
  }
  index.snapshots.sort((a, b) => b.ts.localeCompare(a.ts));
  index.snapshots = index.snapshots.slice(0, 1000);
  await writeDriftIndex(index);
}

export async function saveDiffMeta(diffRecord: DriftDiffRecord): Promise<void> {
  const index = await readDriftIndex();
  index.diffs.unshift({
    diffId: diffRecord.diffId,
    fromSnapshotId: diffRecord.fromSnapshotId,
    toSnapshotId: diffRecord.toSnapshotId,
    ts: diffRecord.ts,
    environment: diffRecord.environment,
    classification: diffRecord.classification,
    severity: diffRecord.diff.summary.severity
  });
  index.diffs = index.diffs
    .filter((entry, idx, arr) => arr.findIndex((candidate) => candidate.diffId === entry.diffId) === idx)
    .slice(0, 1000);
  await writeDriftIndex(index);
}

export async function listSnapshots(filter?: {
  environment?: string;
  classification?: "internal" | "client" | "all";
  limit?: number;
}): Promise<DriftSnapshotMeta[]> {
  const index = await readDriftIndex();
  const limit = Math.max(1, Math.min(filter?.limit ?? 100, 500));
  return index.snapshots
    .filter((entry) => {
      if (filter?.environment && entry.environment !== filter.environment) {
        return false;
      }
      if (filter?.classification && filter.classification !== "all" && entry.classification !== filter.classification) {
        return false;
      }
      return true;
    })
    .slice(0, limit);
}

export async function findPreviousSnapshotMeta(input: {
  environment: string;
  classification: "internal" | "client" | "all";
  beforeTs: string;
}): Promise<DriftSnapshotMeta | null> {
  const index = await readDriftIndex();
  return (
    index.snapshots.find(
      (entry) =>
        entry.environment === input.environment &&
        entry.classification === input.classification &&
        entry.ts < input.beforeTs
    ) ?? null
  );
}

export function getDriftStoragePaths() {
  return {
    driftRoot,
    snapshotsDir,
    diffsDir,
    indexPath
  };
}
