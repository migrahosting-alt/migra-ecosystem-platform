import { NextResponse } from "next/server";

import { createFinding } from "../../../../lib/autonomy/finding";
import { runAutonomyCycle } from "../../../../lib/autonomy/scheduler";
import type { Classification, Finding } from "../../../../lib/autonomy/types";

function asClassification(value: unknown): Classification | undefined {
  return value === "internal" || value === "client" ? value : undefined;
}

function parseSeedFinding(value: unknown): Finding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (typeof row.source !== "string" || !["repo", "inventory", "health"].includes(row.source)) {
    return null;
  }
  if (typeof row.severity !== "string" || !["info", "warn", "critical"].includes(row.severity)) {
    return null;
  }
  if (typeof row.title !== "string" || typeof row.details !== "string") {
    return null;
  }

  const source = row.source as Finding["source"];
  const severity = row.severity as Finding["severity"];

  return createFinding({
    source,
    severity,
    title: row.title,
    details: row.details,
    classification: asClassification(row.classification),
    tenantId: typeof row.tenantId === "string" ? row.tenantId : undefined,
    suggestedMissionTemplateId:
      typeof row.suggestedMissionTemplateId === "string" ? row.suggestedMissionTemplateId : undefined,
    ts: typeof row.ts === "string" ? row.ts : undefined
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    seedFindings?: unknown;
  };

  const seedFindings = Array.isArray(body.seedFindings)
    ? body.seedFindings
        .map((entry) => parseSeedFinding(entry))
        .filter((entry): entry is Finding => Boolean(entry))
    : [];

  const result = await runAutonomyCycle({ seedFindings });
  return NextResponse.json({
    ok: true,
    data: result
  });
}
