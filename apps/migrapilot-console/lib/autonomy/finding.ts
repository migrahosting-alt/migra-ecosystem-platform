import { createHash, randomUUID } from "node:crypto";

import type { Classification, Finding } from "./types";

export function makeDedupeHash(input: {
  source: Finding["source"];
  title: string;
  details: string;
  tenantId?: string;
}): string {
  const key = `${input.source}|${input.title}|${input.details}|${input.tenantId ?? ""}`;
  return createHash("sha256").update(key).digest("hex");
}

export function createFinding(input: {
  source: Finding["source"];
  severity: Finding["severity"];
  title: string;
  details: string;
  classification?: Classification;
  tenantId?: string;
  suggestedMissionTemplateId?: string;
  ts?: string;
}): Finding {
  const ts = input.ts ?? new Date().toISOString();
  const dedupeHash = makeDedupeHash({
    source: input.source,
    title: input.title,
    details: input.details,
    tenantId: input.tenantId
  });

  return {
    findingId: `finding_${randomUUID()}`,
    ts,
    source: input.source,
    severity: input.severity,
    title: input.title,
    details: input.details,
    classification: input.classification,
    tenantId: input.tenantId,
    suggestedMissionTemplateId: input.suggestedMissionTemplateId,
    dedupeHash
  };
}
