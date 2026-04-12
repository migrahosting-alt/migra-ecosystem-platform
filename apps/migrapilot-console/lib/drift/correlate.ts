import type { MissionRecord } from "../mission/types";
import type {
  DriftCorrelation,
  DriftCorrelationCandidate,
  DriftCorrelationImpact,
  DriftDiffResult,
  DriftSnapshot
} from "./types";

interface CorrelateInput {
  fromSnapshot: DriftSnapshot;
  toSnapshot: DriftSnapshot;
  diff: DriftDiffResult;
  journalEntries: unknown[];
  missionsIndex: MissionRecord[];
}

interface DriftImpactIndex {
  tenantIds: string[];
  domains: string[];
  podIds: string[];
  serviceIds: string[];
  classification: "internal" | "client" | undefined;
}

interface CandidateDraft {
  kind: "mission" | "journal";
  missionId?: string;
  runId?: string;
  journalEntryId?: string;
  jobId?: string;
  toolName?: string;
  ts?: string;
  impacted: DriftCorrelationImpact;
  classification?: "internal" | "client";
  evidenceText: string;
  sourceId: string;
}

interface ScoredCandidate {
  candidate: DriftCorrelationCandidate;
  sourceId: string;
}

const DRIFT_CAUSING_TOOL_PREFIXES = [
  "dns.",
  "pods.",
  "storage.",
  "deploy.",
  "repo.applyPatch",
  "git.push"
];

const READ_ONLY_TOOL_PREFIXES = [
  "inventory.",
  "journal.list",
  "system.context",
  "repo.search",
  "repo.readFile",
  "repo.listFiles",
  "repo.status",
  "repo.diff"
];

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asIso(value: unknown): string | undefined {
  const text = asString(value);
  if (!text) {
    return undefined;
  }
  return Number.isNaN(Date.parse(text)) ? undefined : text;
}

function lower(value: string): string {
  return value.toLowerCase();
}

function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).filter((item) => item.trim().length > 0))).sort((a, b) =>
    a.localeCompare(b)
  );
}

function intersects(left: string[], rightSet: Set<string>): boolean {
  for (const value of left) {
    if (rightSet.has(value)) {
      return true;
    }
  }
  return false;
}

function matchValuesFromText(values: string[], text: string): string[] {
  if (!text) {
    return [];
  }
  const haystack = lower(text);
  return values.filter((value) => haystack.includes(lower(value)));
}

function collectImpacted(diff: DriftDiffResult): DriftImpactIndex {
  const tenantIds = new Set<string>(diff.summary.affectedTenants);
  const domains = new Set<string>();
  const podIds = new Set<string>();
  const serviceIds = new Set<string>();

  for (const item of diff.added.pods) {
    if (item.tenantId) tenantIds.add(item.tenantId);
    podIds.add(item.podId);
  }
  for (const item of diff.removed.pods) {
    if (item.tenantId) tenantIds.add(item.tenantId);
    podIds.add(item.podId);
  }
  for (const change of diff.changed.pods) {
    if (change.before.tenantId) tenantIds.add(change.before.tenantId);
    if (change.after.tenantId) tenantIds.add(change.after.tenantId);
    podIds.add(change.before.podId);
    podIds.add(change.after.podId);
  }

  for (const item of diff.added.domains) {
    if (item.tenantId) tenantIds.add(item.tenantId);
    domains.add(item.domain);
    if (item.podId) podIds.add(item.podId);
  }
  for (const item of diff.removed.domains) {
    if (item.tenantId) tenantIds.add(item.tenantId);
    domains.add(item.domain);
    if (item.podId) podIds.add(item.podId);
  }
  for (const change of diff.changed.domains) {
    if (change.before.tenantId) tenantIds.add(change.before.tenantId);
    if (change.after.tenantId) tenantIds.add(change.after.tenantId);
    domains.add(change.before.domain);
    domains.add(change.after.domain);
    if (change.before.podId) podIds.add(change.before.podId);
    if (change.after.podId) podIds.add(change.after.podId);
  }

  for (const item of diff.added.services) {
    serviceIds.add(item.serviceId);
  }
  for (const item of diff.removed.services) {
    serviceIds.add(item.serviceId);
  }
  for (const change of diff.changed.services) {
    serviceIds.add(change.before.serviceId);
    serviceIds.add(change.after.serviceId);
  }
  for (const edge of diff.added.edges) {
    serviceIds.add(edge.from);
    serviceIds.add(edge.to);
  }
  for (const edge of diff.removed.edges) {
    serviceIds.add(edge.from);
    serviceIds.add(edge.to);
  }

  let classification: "internal" | "client" | undefined;
  if (diff.summary.affectedClassification.internal > 0 && diff.summary.affectedClassification.client === 0) {
    classification = "internal";
  }
  if (diff.summary.affectedClassification.client > 0 && diff.summary.affectedClassification.internal === 0) {
    classification = "client";
  }

  return {
    tenantIds: uniqueSorted(tenantIds),
    domains: uniqueSorted(domains),
    podIds: uniqueSorted(podIds),
    serviceIds: uniqueSorted(serviceIds),
    classification
  };
}

function scoreCandidate(input: {
  draft: CandidateDraft;
  impactIndex: DriftImpactIndex;
  fromTs: string;
  toTs: string;
}): ScoredCandidate {
  const tenantSet = new Set(input.impactIndex.tenantIds);
  const domainSet = new Set(input.impactIndex.domains);
  const fromTime = Date.parse(input.fromTs);
  const toTime = Date.parse(input.toTs);

  let score = 0;
  const reasons: string[] = [];

  if (intersects(input.draft.impacted.tenantIds ?? [], tenantSet)) {
    score += 0.4;
    reasons.push("matches affected tenant");
  }

  if (intersects(input.draft.impacted.domains ?? [], domainSet)) {
    score += 0.3;
    reasons.push("matches affected domain");
  }

  const toolName = input.draft.toolName ?? "";
  if (DRIFT_CAUSING_TOOL_PREFIXES.some((prefix) => toolName.startsWith(prefix))) {
    score += 0.2;
    reasons.push("tool commonly causes drift");
  }

  if (input.draft.ts) {
    const ts = Date.parse(input.draft.ts);
    if (Number.isFinite(ts) && Number.isFinite(fromTime) && Number.isFinite(toTime)) {
      if (ts >= fromTime && ts <= toTime) {
        score += 0.15;
        reasons.push("timestamp inside drift window");
      } else {
        const marginMs = 60 * 60 * 1000;
        if (ts >= fromTime - marginMs && ts <= toTime + marginMs) {
          score += 0.08;
          reasons.push("timestamp near drift window");
        }
      }
    }
  }

  if (input.impactIndex.classification && input.draft.classification === input.impactIndex.classification) {
    score += 0.1;
    reasons.push(`classification matches (${input.impactIndex.classification})`);
  }

  if (READ_ONLY_TOOL_PREFIXES.some((prefix) => toolName.startsWith(prefix))) {
    score -= 0.2;
    reasons.push("read-only tool lowers confidence");
  }

  const boundedScore = Math.max(0, Math.min(1, Number(score.toFixed(4))));

  return {
    sourceId: input.draft.sourceId,
    candidate: {
      kind: input.draft.kind,
      missionId: input.draft.missionId,
      runId: input.draft.runId,
      journalEntryId: input.draft.journalEntryId,
      jobId: input.draft.jobId,
      toolName: input.draft.toolName,
      ts: input.draft.ts,
      score: boundedScore,
      reasons,
      impacted: {
        tenantIds: uniqueSorted(input.draft.impacted.tenantIds ?? []),
        domains: uniqueSorted(input.draft.impacted.domains ?? []),
        podIds: uniqueSorted(input.draft.impacted.podIds ?? []),
        serviceIds: uniqueSorted(input.draft.impacted.serviceIds ?? [])
      }
    }
  };
}

function extractImpactedFromEvidence(input: {
  evidenceText: string;
  impactIndex: DriftImpactIndex;
}): DriftCorrelationImpact {
  return {
    tenantIds: matchValuesFromText(input.impactIndex.tenantIds, input.evidenceText),
    domains: matchValuesFromText(input.impactIndex.domains, input.evidenceText),
    podIds: matchValuesFromText(input.impactIndex.podIds, input.evidenceText),
    serviceIds: matchValuesFromText(input.impactIndex.serviceIds, input.evidenceText)
  };
}

function inferClassificationFromImpact(input: DriftCorrelationImpact, snapshot: DriftSnapshot): "internal" | "client" | undefined {
  const tenantClassById = new Map(snapshot.state.tenants.map((tenant) => [tenant.tenantId, tenant.classification]));
  const domainClassById = new Map(snapshot.state.domains.map((domain) => [domain.domain, domain.classification]));

  for (const tenantId of input.tenantIds ?? []) {
    const value = tenantClassById.get(tenantId);
    if (value === "internal" || value === "client") {
      return value;
    }
  }

  for (const domain of input.domains ?? []) {
    const value = domainClassById.get(domain);
    if (value === "internal" || value === "client") {
      return value;
    }
  }

  return undefined;
}

function missionDrafts(missions: MissionRecord[], impactIndex: DriftImpactIndex, snapshot: DriftSnapshot): CandidateDraft[] {
  const ordered = [...missions].sort((a, b) => {
    const ts = a.createdAt.localeCompare(b.createdAt);
    if (ts !== 0) {
      return ts;
    }
    return a.missionId.localeCompare(b.missionId);
  });

  const drafts: CandidateDraft[] = [];

  for (const mission of ordered) {
    const taskById = new Map(mission.tasks.map((task) => [task.taskId, task]));
    const runs = [...mission.toolRuns].sort((a, b) => {
      const ts = a.createdAt.localeCompare(b.createdAt);
      if (ts !== 0) {
        return ts;
      }
      return a.id.localeCompare(b.id);
    });

    for (const run of runs) {
      const task = taskById.get(run.taskId);
      const taskInputs = task?.toolCalls
        .filter((call) => call.toolName === run.toolName)
        .map((call) => call.input);

      const evidenceText = [
        mission.goal,
        mission.context?.notes,
        task?.title,
        task?.intent,
        run.runId,
        run.toolName,
        JSON.stringify(taskInputs ?? []),
        JSON.stringify(mission.origin ?? {})
      ]
        .filter((item): item is string => typeof item === "string")
        .join("\n");

      const impacted = extractImpactedFromEvidence({ evidenceText, impactIndex });
      const classification = inferClassificationFromImpact(impacted, snapshot);

      drafts.push({
        kind: "mission",
        missionId: mission.missionId,
        runId: run.runId,
        journalEntryId: run.journalEntryId,
        jobId: run.jobId,
        toolName: run.toolName,
        ts: run.createdAt || mission.createdAt,
        impacted,
        classification,
        evidenceText,
        sourceId: `mission:${mission.missionId}:${run.id}`
      });
    }
  }

  return drafts;
}

function journalDrafts(entries: unknown[], impactIndex: DriftImpactIndex, snapshot: DriftSnapshot): CandidateDraft[] {
  const drafts: CandidateDraft[] = [];

  for (const entry of entries) {
    const record = asRecord(entry);
    const journalEntryId = asString(record.id) ?? asString(record.entryId);
    if (!journalEntryId) {
      continue;
    }

    const toolName = asString(record.tool);
    const runId = asString(record.runId);
    const ts = asIso(record.ts);

    const evidenceText = [
      asString(record.summary),
      runId,
      toolName,
      JSON.stringify(record.details ?? {}),
      JSON.stringify(record.verification ?? {}),
      JSON.stringify(record.rollback ?? {}),
      JSON.stringify(record.tags ?? [])
    ]
      .filter((item): item is string => typeof item === "string")
      .join("\n");

    const impacted = extractImpactedFromEvidence({ evidenceText, impactIndex });
    const classification = inferClassificationFromImpact(impacted, snapshot);

    drafts.push({
      kind: "journal",
      runId,
      journalEntryId,
      toolName,
      ts,
      impacted,
      classification,
      evidenceText,
      sourceId: `journal:${journalEntryId}`
    });
  }

  return drafts;
}

function filterJournalEntriesByWindow(
  entries: unknown[],
  fromTs: string,
  toTs: string
): unknown[] {
  const from = Date.parse(fromTs);
  const to = Date.parse(toTs);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return entries;
  }

  const bufferedFrom = from - 6 * 60 * 60 * 1000;
  const bufferedTo = to + 6 * 60 * 60 * 1000;
  let hasTimestamp = false;

  const filtered = entries.filter((entry) => {
    const record = asRecord(entry);
    const ts = asIso(record.ts);
    if (!ts) {
      return true;
    }
    hasTimestamp = true;
    const value = Date.parse(ts);
    if (!Number.isFinite(value)) {
      return true;
    }
    return value >= bufferedFrom && value <= bufferedTo;
  });

  return hasTimestamp ? filtered : entries;
}

function compareCandidates(a: ScoredCandidate, b: ScoredCandidate): number {
  if (a.candidate.score !== b.candidate.score) {
    return b.candidate.score - a.candidate.score;
  }
  const tsA = a.candidate.ts ?? "";
  const tsB = b.candidate.ts ?? "";
  if (tsA !== tsB) {
    return tsA.localeCompare(tsB);
  }
  return a.sourceId.localeCompare(b.sourceId);
}

function buildSummary(best: DriftCorrelationCandidate | undefined): string {
  if (!best || best.score < 0.55) {
    return "No strong cause found; drift may be external/manual change.";
  }

  const kindLabel = best.kind === "mission" ? `mission ${best.missionId ?? "unknown"}` : `journal ${best.journalEntryId ?? "unknown"}`;
  const tool = best.toolName ? ` via ${best.toolName}` : "";
  return `Likely cause: ${kindLabel}${tool} (confidence ${(best.score * 100).toFixed(0)}%).`;
}

export function correlateDrift(input: CorrelateInput): DriftCorrelation {
  const impactIndex = collectImpacted(input.diff);
  const candidates: ScoredCandidate[] = [];
  const scopedJournalEntries = filterJournalEntriesByWindow(
    input.journalEntries,
    input.fromSnapshot.ts,
    input.toSnapshot.ts
  );

  const missionCandidates = missionDrafts(input.missionsIndex, impactIndex, input.toSnapshot);
  const journalCandidates = journalDrafts(scopedJournalEntries, impactIndex, input.toSnapshot);

  for (const draft of [...missionCandidates, ...journalCandidates]) {
    const scored = scoreCandidate({
      draft,
      impactIndex,
      fromTs: input.fromSnapshot.ts,
      toTs: input.toSnapshot.ts
    });

    if (scored.candidate.score > 0) {
      candidates.push(scored);
    }
  }

  candidates.sort(compareCandidates);
  const topCandidates = candidates.slice(0, 10).map((entry) => entry.candidate);
  const best = topCandidates[0] && topCandidates[0].score >= 0.55 ? topCandidates[0] : undefined;

  return {
    window: {
      fromTs: input.fromSnapshot.ts,
      toTs: input.toSnapshot.ts
    },
    candidates: topCandidates,
    best,
    summary: buildSummary(best)
  };
}
