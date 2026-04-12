import { writeJsonArtifact, writeTextArtifact } from "../server/artifact-storage";
import type { MissionReport } from "./types";

export async function persistMissionReportArtifacts(report: MissionReport): Promise<MissionReport> {
  const generatedAt = new Date().toISOString();

  try {
    const [jsonArtifact, markdownArtifact] = await Promise.all([
      writeJsonArtifact({
        category: "mission-reports",
        relativePath: `${report.missionId}/report.json`,
        data: report,
        metadata: {
          missionid: report.missionId,
          status: report.status,
          format: "json"
        }
      }),
      writeTextArtifact({
        category: "mission-reports",
        relativePath: `${report.missionId}/report.md`,
        text: report.markdown,
        contentType: "text/markdown; charset=utf-8",
        metadata: {
          missionid: report.missionId,
          status: report.status,
          format: "markdown"
        }
      })
    ]);

    if (!jsonArtifact && !markdownArtifact) {
      return report;
    }

    return {
      ...report,
      artifacts: {
        generatedAt,
        json: jsonArtifact,
        markdown: markdownArtifact
      }
    };
  } catch (error) {
    console.warn(
      `[migrapilot] failed to persist mission report artifacts for ${report.missionId}:`,
      (error as Error).message
    );
    return report;
  }
}
