import { buildMissionReport } from "../lib/mission/report";
import { persistMissionReportArtifacts } from "../lib/mission/report-artifacts";
import { listMissions } from "../lib/mission/store";
import {
  readDiffById,
  readDriftIndex,
  readSnapshot,
  writeDiff,
  writeDriftIndex,
  writeSnapshot
} from "../lib/drift/store";
import { artifactStorageHealth, isArtifactStorageEnabled } from "../lib/server/artifact-storage";

async function main() {
  const health = await artifactStorageHealth();
  if (!isArtifactStorageEnabled()) {
    throw new Error("MigraPilot artifact storage is not configured");
  }

  const index = await readDriftIndex();
  let mirroredSnapshots = 0;
  let mirroredDiffs = 0;
  let mirroredReports = 0;

  for (const meta of index.snapshots) {
    const snapshot = await readSnapshot(meta.snapshotId);
    if (!snapshot) {
      continue;
    }
    await writeSnapshot(snapshot);
    mirroredSnapshots += 1;
  }

  for (const meta of index.diffs) {
    const diff = await readDiffById(meta.diffId);
    if (!diff) {
      continue;
    }
    await writeDiff(diff);
    mirroredDiffs += 1;
  }

  await writeDriftIndex(index);

  for (const mission of listMissions(500)) {
    const report = await buildMissionReport(mission);
    const persisted = await persistMissionReportArtifacts(report);
    if (persisted.artifacts?.json || persisted.artifacts?.markdown) {
      mirroredReports += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        storage: health,
        mirroredSnapshots,
        mirroredDiffs,
        mirroredReports
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: (error as Error).message
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
