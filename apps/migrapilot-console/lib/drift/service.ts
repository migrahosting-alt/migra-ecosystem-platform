import { randomUUID } from "node:crypto";

import { createFinding } from "../autonomy/finding";
import { trimAutonomyState, updateAutonomyState } from "../autonomy/store";
import { TEMPLATE_DRIFT_INVESTIGATE } from "../autonomy/templates";
import {
  emitDriftCorrelated,
  emitDriftSnapshot,
  emitFindingAdded
} from "../activity/store";
import { listMissions } from "../mission/store";
import { executeViaBrainApi } from "../mission/execute-api";
import { correlateDrift } from "./correlate";
import { diffSnapshots } from "./diff";
import { normalizeInventoryState, snapshotClassificationSummary } from "./normalize";
import {
  findPreviousSnapshotMeta,
  listSnapshots,
  readDiffById,
  readDriftIndex,
  readSnapshot,
  saveDiffMeta,
  saveSnapshotMeta,
  writeDiff,
  writeSnapshot
} from "./store";
import type {
  CreateSnapshotInput,
  CreateSnapshotResult,
  DriftClassification,
  DriftClassificationFilter,
  DriftCorrelationCandidate,
  DriftDiffRecord,
  DriftSnapshot,
  DriftSnapshotMeta
} from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function validateEnvironment(value: unknown): "dev" | "stage" | "staging" | "prod" | "test" {
  if (value === "dev" || value === "stage" || value === "staging" || value === "prod" || value === "test") {
    return value;
  }
  return "prod";
}

function validateClassification(value: unknown): DriftClassificationFilter {
  if (value === "internal" || value === "client" || value === "all") {
    return value;
  }
  return "all";
}

function createSnapshotId(ts: string): string {
  const compact = ts.replace(/[.:TZ-]/g, "").slice(0, 14);
  return `snap_${compact}_${randomUUID().slice(0, 8)}`;
}

async function runInventoryTool(input: {
  toolName:
    | "inventory.tenants.list"
    | "inventory.pods.list"
    | "inventory.domains.map"
    | "inventory.services.topology"
    | "system.context";
  environment: "dev" | "stage" | "staging" | "prod" | "test";
  classification: DriftClassificationFilter;
  runId: string;
}): Promise<Record<string, unknown>> {
  const filter = {
    limit: 500,
    offset: 0,
    filterEnvironment: input.environment,
    ...(input.classification !== "all" ? { classification: input.classification } : {})
  };

  const toolInput =
    input.toolName === "system.context"
      ? { environment: input.environment }
      : {
          filter
        };

  const execution = await executeViaBrainApi({
    runnerTarget: "server",
    toolName: input.toolName,
    toolInput,
    environment: input.environment,
    operator: {
      operatorId: "drift-snapshot",
      role: "ops"
    },
    runId: input.runId,
    autonomyBudgetId: "drift-snapshot"
  });

  if (!execution.result?.ok) {
    throw new Error(`${input.toolName} failed: ${execution.result?.error?.message ?? "unknown error"}`);
  }

  return asRecord(execution.result.data);
}

async function captureInventoryState(input: {
  environment: "dev" | "stage" | "staging" | "prod" | "test";
  classification: DriftClassificationFilter;
  runIdBase: string;
}): Promise<{
  state: DriftSnapshot["state"];
  registryHash: string | null;
}> {
  const [tenantsPayload, podsPayload, domainsPayload, servicesPayload, contextPayload] = await Promise.all([
    runInventoryTool({
      toolName: "inventory.tenants.list",
      environment: input.environment,
      classification: input.classification,
      runId: `${input.runIdBase}_tenants`
    }),
    runInventoryTool({
      toolName: "inventory.pods.list",
      environment: input.environment,
      classification: input.classification,
      runId: `${input.runIdBase}_pods`
    }),
    runInventoryTool({
      toolName: "inventory.domains.map",
      environment: input.environment,
      classification: input.classification,
      runId: `${input.runIdBase}_domains`
    }),
    runInventoryTool({
      toolName: "inventory.services.topology",
      environment: input.environment,
      classification: input.classification,
      runId: `${input.runIdBase}_services`
    }),
    runInventoryTool({
      toolName: "system.context",
      environment: input.environment,
      classification: input.classification,
      runId: `${input.runIdBase}_context`
    }).catch(() => ({}))
  ]);

  const state = normalizeInventoryState({
    tenants: asArray(tenantsPayload.items),
    pods: asArray(podsPayload.items),
    domains: asArray(domainsPayload.items),
    services: asArray(servicesPayload.services),
    edges: asArray(servicesPayload.edges)
  });

  const contextRegistry = asRecord(asRecord(contextPayload).registry);
  const registryHash = typeof contextRegistry.hash === "string" ? contextRegistry.hash : null;

  return {
    state,
    registryHash
  };
}

function formatDriftFindingDetails(input: {
  snapshotId: string;
  prevSnapshotId: string;
  summary: DriftDiffRecord["diff"]["summary"];
  likelyCause?: DriftCorrelationCandidate;
  correlationSummary?: string;
}): string {
  return JSON.stringify(
    {
      snapshotId: input.snapshotId,
      prevSnapshotId: input.prevSnapshotId,
      summary: input.summary,
      affectedTenants: input.summary.affectedTenants,
      affectedClassification: input.summary.affectedClassification,
      likelyCause: input.likelyCause ?? null,
      correlationSummary: input.correlationSummary ?? null
    },
    null,
    2
  );
}

function addAutonomyFindingFromDiff(input: {
  diffRecord: DriftDiffRecord;
  snapshotMeta: DriftSnapshotMeta;
}): void {
  const severity = input.diffRecord.diff.summary.severity;
  const finding = createFinding({
    source: "inventory",
    severity,
    title: `Drift detected (${severity}) in ${input.snapshotMeta.environment}/${input.snapshotMeta.classification}`,
    details: formatDriftFindingDetails({
      snapshotId: input.snapshotMeta.snapshotId,
      prevSnapshotId: input.diffRecord.fromSnapshotId,
      summary: input.diffRecord.diff.summary,
      likelyCause: input.diffRecord.diff.correlation?.best,
      correlationSummary: input.diffRecord.diff.correlation?.summary
    }),
    classification:
      input.diffRecord.diff.summary.affectedClassification.internal >
      input.diffRecord.diff.summary.affectedClassification.client
        ? "internal"
        : input.diffRecord.diff.summary.affectedClassification.client > 0
          ? "client"
          : undefined,
    tenantId: input.diffRecord.diff.summary.affectedTenants[0],
    suggestedMissionTemplateId: TEMPLATE_DRIFT_INVESTIGATE
  });

  updateAutonomyState((state) => {
    const next = {
      ...state,
      findings: [...state.findings],
      queue: state.queue.map((entry) => ({
        ...entry,
        outputsRefs: [...entry.outputsRefs],
        processedRunIds: [...(entry.processedRunIds ?? [])]
      })),
      dedupe: [...state.dedupe]
    };

    const now = Date.now();
    const existing = next.dedupe.find((entry) => entry.hash === finding.dedupeHash);
    const existingTs = existing ? Date.parse(existing.ts) : NaN;
    if (Number.isFinite(existingTs) && now - existingTs <= 10 * 60 * 1000) {
      return next;
    }

    next.findings.unshift(finding);
    next.findings = next.findings.slice(0, 500);
    next.dedupe.push({ hash: finding.dedupeHash, ts: finding.ts });
    next.dedupe = next.dedupe.slice(-2000);

    if (severity === "critical") {
      const alreadyQueued = next.queue.some((entry) => entry.findingId === finding.findingId);
      if (!alreadyQueued) {
        next.queue.unshift({
          queueId: `queue_${randomUUID()}`,
          findingId: finding.findingId,
          templateId: TEMPLATE_DRIFT_INVESTIGATE,
          status: "queued",
          attempts: 0,
          createdAt: nowIso(),
          updatedAt: nowIso(),
          sourceClassification: finding.classification,
          affectedTenants: finding.tenantId ? [finding.tenantId] : undefined,
          outputsRefs: [],
          processedRunIds: []
        });
      }
    }

    return trimAutonomyState(next);
  });

  emitFindingAdded({ findingId: finding.findingId, title: finding.title, severity: finding.severity });
}

function parseJournalEntries(value: unknown): unknown[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const data = value as Record<string, unknown>;
  if (!data.entries || !Array.isArray(data.entries)) {
    return [];
  }
  return data.entries;
}

async function loadJournalEntriesForCorrelation(input: {
  environment: string;
  runId: string;
}): Promise<unknown[]> {
  const environment = validateEnvironment(input.environment);
  const execution = await executeViaBrainApi({
    runnerTarget: "server",
    toolName: "journal.list",
    toolInput: {
      filter: {
        limit: 500
      }
    },
    environment,
    operator: {
      operatorId: "drift-correlation",
      role: "ops"
    },
    runId: input.runId,
    autonomyBudgetId: "drift-correlation"
  });

  if (!execution.result?.ok) {
    return [];
  }

  return parseJournalEntries(execution.result.data);
}

async function buildCorrelation(input: {
  fromSnapshot: DriftSnapshot;
  toSnapshot: DriftSnapshot;
  diff: DriftDiffRecord["diff"];
  runIdBase: string;
}) {
  const [journalEntries, missionsIndex] = await Promise.all([
    loadJournalEntriesForCorrelation({
      environment: input.toSnapshot.environment,
      runId: `${input.runIdBase}_journal`
    }).catch(() => []),
    Promise.resolve(listMissions(300))
  ]);

  return correlateDrift({
    fromSnapshot: input.fromSnapshot,
    toSnapshot: input.toSnapshot,
    diff: input.diff,
    journalEntries,
    missionsIndex
  });
}

export async function createDriftSnapshot(rawInput: Partial<CreateSnapshotInput>): Promise<CreateSnapshotResult> {
  const environment = validateEnvironment(rawInput.environment);
  const classification = validateClassification(rawInput.classification);
  const ts = nowIso();
  const snapshotId = createSnapshotId(ts);
  const runIdBase = `drift_${snapshotId}`;

  const captured = await captureInventoryState({
    environment,
    classification,
    runIdBase
  });

  const snapshot: DriftSnapshot = {
    snapshotId,
    ts,
    environment,
    classification,
    source: "inventory",
    note: rawInput.note?.trim() ? rawInput.note.trim() : null,
    registryHash: captured.registryHash,
    classificationSummary: snapshotClassificationSummary({ state: captured.state }),
    state: captured.state
  };

  await writeSnapshot(snapshot);

  const previousMeta = await findPreviousSnapshotMeta({
    environment,
    classification,
    beforeTs: ts
  });

  let diffRecord: DriftDiffRecord | null = null;
  if (previousMeta) {
    const previousSnapshot = await readSnapshot(previousMeta.snapshotId);
    if (previousSnapshot) {
      const baseDiff = diffSnapshots(previousSnapshot, snapshot);
      const correlation = await buildCorrelation({
        fromSnapshot: previousSnapshot,
        toSnapshot: snapshot,
        diff: baseDiff,
        runIdBase
      });
      diffRecord = {
        diffId: `diff_${previousSnapshot.snapshotId}_${snapshot.snapshotId}`,
        fromSnapshotId: previousSnapshot.snapshotId,
        toSnapshotId: snapshot.snapshotId,
        ts,
        environment,
        classification,
        diff: {
          ...baseDiff,
          correlation
        }
      };
      await writeDiff(diffRecord);
      await saveDiffMeta(diffRecord);
    }
  }

  const meta: DriftSnapshotMeta = {
    snapshotId,
    ts,
    environment,
    classification,
    note: snapshot.note,
    prevSnapshotId: previousMeta?.snapshotId ?? null,
    diffId: diffRecord?.diffId ?? null,
    severity: diffRecord?.diff.summary.severity ?? null,
    affectedTenants: diffRecord?.diff.summary.affectedTenants ?? []
  };

  await saveSnapshotMeta(meta);

  if (diffRecord && (diffRecord.diff.summary.totalAdded > 0 || diffRecord.diff.summary.totalRemoved > 0 || diffRecord.diff.summary.totalChanged > 0)) {
    const severity = diffRecord.diff.summary.severity;
    emitDriftSnapshot({ snapshotId, environment, severity });
    if (diffRecord.diff.correlation) {
      const corr = diffRecord.diff.correlation;
      emitDriftCorrelated({
        snapshotId,
        summary: corr.summary,
        confidence: corr.best?.score,
        missionId: corr.best?.missionId
      });
    }
    addAutonomyFindingFromDiff({ diffRecord, snapshotMeta: meta });
  }

  return {
    snapshot,
    meta,
    previousSnapshotId: previousMeta?.snapshotId ?? null,
    diffRecord
  };
}

export async function listDriftSnapshots(input?: {
  environment?: string;
  classification?: DriftClassificationFilter;
  limit?: number;
}): Promise<DriftSnapshotMeta[]> {
  return listSnapshots({
    environment: input?.environment,
    classification: input?.classification,
    limit: input?.limit
  });
}

export async function getDriftSnapshot(snapshotId: string): Promise<DriftSnapshot | null> {
  return readSnapshot(snapshotId);
}

export async function getDriftDiff(fromSnapshotId: string, toSnapshotId: string): Promise<DriftDiffRecord | null> {
  const index = await readDriftIndex();
  const existing = index.diffs.find(
    (entry) => entry.fromSnapshotId === fromSnapshotId && entry.toSnapshotId === toSnapshotId
  );
  if (existing) {
    const diff = await readDiffById(existing.diffId);
    if (diff) {
      if (diff.diff.correlation) {
        return diff;
      }
      const fromSnapshot = await readSnapshot(fromSnapshotId);
      const toSnapshot = await readSnapshot(toSnapshotId);
      if (!fromSnapshot || !toSnapshot) {
        return diff;
      }
      const correlation = await buildCorrelation({
        fromSnapshot,
        toSnapshot,
        diff: diff.diff,
        runIdBase: `drift_corr_${toSnapshotId}`
      });
      const enriched: DriftDiffRecord = {
        ...diff,
        diff: {
          ...diff.diff,
          correlation
        }
      };
      await writeDiff(enriched);
      return enriched;
    }
  }

  const fromSnapshot = await readSnapshot(fromSnapshotId);
  const toSnapshot = await readSnapshot(toSnapshotId);
  if (!fromSnapshot || !toSnapshot) {
    return null;
  }

  const baseDiff = diffSnapshots(fromSnapshot, toSnapshot);
  const correlation = await buildCorrelation({
    fromSnapshot,
    toSnapshot,
    diff: baseDiff,
    runIdBase: `drift_corr_${toSnapshotId}`
  });

  return {
    diffId: `diff_${fromSnapshotId}_${toSnapshotId}`,
    fromSnapshotId,
    toSnapshotId,
    ts: nowIso(),
    environment: toSnapshot.environment,
    classification: toSnapshot.classification,
    diff: {
      ...baseDiff,
      correlation
    }
  };
}

export async function getDriftCorrelation(
  fromSnapshotId: string,
  toSnapshotId: string
) {
  const diff = await getDriftDiff(fromSnapshotId, toSnapshotId);
  return diff?.diff.correlation ?? null;
}

export function parseClassification(value: unknown): DriftClassificationFilter {
  return validateClassification(value);
}

export function parseEnvironment(value: unknown): "dev" | "stage" | "staging" | "prod" | "test" {
  return validateEnvironment(value);
}

export function parseClassificationValue(value: unknown): DriftClassification | undefined {
  if (value === "internal" || value === "client") {
    return value;
  }
  return undefined;
}
