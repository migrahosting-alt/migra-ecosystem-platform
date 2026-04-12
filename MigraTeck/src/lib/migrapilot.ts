import {
  PilotApprovalStatus,
  PilotArtifactRedactionState,
  PilotPolicyDecisionResult,
  PilotRollbackState,
  PilotRunStatus,
  PilotRunStepStatus,
  PilotVerificationState,
  ProductKey,
  ResourceNodeType,
  ResourceRelationshipType,
  ServiceHealthState,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function toOptionalJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined || value === null) {
    return Prisma.JsonNull;
  }

  return toJsonValue(value);
}

export interface CreatePilotRunInput {
  source: string;
  intent: string;
  actorUserId?: string | null;
  delegatedByPrincipalId?: string | null;
  orgId?: string | null;
  environment?: string;
  commandName?: string | null;
  riskTier?: number;
  status?: PilotRunStatus;
  verificationState?: PilotVerificationState;
  rollbackState?: PilotRollbackState;
  correlationId?: string | null;
  summary?: string | null;
  startedAt?: Date;
  finishedAt?: Date | null;
}

export async function createPilotRun(input: CreatePilotRunInput) {
  return prisma.pilotRun.create({
    data: {
      source: input.source,
      intent: input.intent,
      actorUserId: input.actorUserId ?? null,
      delegatedByPrincipalId: input.delegatedByPrincipalId ?? null,
      orgId: input.orgId ?? null,
      environment: input.environment ?? "dev",
      commandName: input.commandName ?? null,
      riskTier: input.riskTier ?? 1,
      status: input.status ?? PilotRunStatus.REQUESTED,
      verificationState: input.verificationState ?? PilotVerificationState.PENDING,
      rollbackState: input.rollbackState ?? PilotRollbackState.NOT_REQUIRED,
      correlationId: input.correlationId ?? null,
      summary: input.summary ?? null,
      startedAt: input.startedAt ?? new Date(),
      finishedAt: input.finishedAt ?? null,
    },
  });
}

export interface CreatePilotRunStepInput {
  pilotRunId: string;
  sequence: number;
  stepType: string;
  title: string;
  description?: string | null;
  status?: PilotRunStepStatus;
  targetType?: string | null;
  targetId?: string | null;
  retryCount?: number;
  rollbackStep?: boolean;
  verificationRequired?: boolean;
  startedAt?: Date | null;
  finishedAt?: Date | null;
}

export async function createPilotRunStep(input: CreatePilotRunStepInput) {
  return prisma.pilotRunStep.create({
    data: {
      pilotRunId: input.pilotRunId,
      sequence: input.sequence,
      stepType: input.stepType,
      title: input.title,
      description: input.description ?? null,
      status: input.status ?? PilotRunStepStatus.PENDING,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      retryCount: input.retryCount ?? 0,
      rollbackStep: input.rollbackStep ?? false,
      verificationRequired: input.verificationRequired ?? true,
      startedAt: input.startedAt ?? null,
      finishedAt: input.finishedAt ?? null,
    },
  });
}

export interface AppendPilotEventInput {
  pilotRunId: string;
  pilotRunStepId?: string | null;
  eventType: string;
  message: string;
  severity?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function appendPilotEvent(input: AppendPilotEventInput) {
  return prisma.pilotEvent.create({
    data: {
      pilotRunId: input.pilotRunId,
      pilotRunStepId: input.pilotRunStepId ?? null,
      eventType: input.eventType,
      message: input.message,
      severity: input.severity ?? null,
      metadata: toOptionalJson(input.metadata),
    },
  });
}

export interface RecordPilotPolicyDecisionInput {
  pilotRunId: string;
  policyName: string;
  decision: PilotPolicyDecisionResult;
  reason?: string | null;
  riskTier?: number;
  requiresApproval?: boolean;
  blocked?: boolean;
  metadata?: Record<string, unknown> | null;
}

export async function recordPilotPolicyDecision(input: RecordPilotPolicyDecisionInput) {
  return prisma.pilotPolicyDecision.create({
    data: {
      pilotRunId: input.pilotRunId,
      policyName: input.policyName,
      decision: input.decision,
      reason: input.reason ?? null,
      riskTier: input.riskTier ?? 1,
      requiresApproval: input.requiresApproval ?? false,
      blocked: input.blocked ?? false,
      metadata: toOptionalJson(input.metadata),
    },
  });
}

export interface CreatePilotApprovalInput {
  pilotRunId: string;
  approvalType: string;
  status?: PilotApprovalStatus;
  requestedByUserId?: string | null;
  approverUserId?: string | null;
  reason?: string | null;
  riskSummary?: string | null;
  blastRadiusSummary?: string | null;
  rollbackPlanSummary?: string | null;
  verificationPlanSummary?: string | null;
  requestedAt?: Date;
  decidedAt?: Date | null;
}

export async function createPilotApproval(input: CreatePilotApprovalInput) {
  return prisma.pilotApproval.create({
    data: {
      pilotRunId: input.pilotRunId,
      approvalType: input.approvalType,
      status: input.status ?? PilotApprovalStatus.PENDING,
      requestedByUserId: input.requestedByUserId ?? null,
      approverUserId: input.approverUserId ?? null,
      reason: input.reason ?? null,
      riskSummary: input.riskSummary ?? null,
      blastRadiusSummary: input.blastRadiusSummary ?? null,
      rollbackPlanSummary: input.rollbackPlanSummary ?? null,
      verificationPlanSummary: input.verificationPlanSummary ?? null,
      requestedAt: input.requestedAt ?? new Date(),
      decidedAt: input.decidedAt ?? null,
    },
  });
}

export interface CreatePilotArtifactInput {
  pilotRunId: string;
  artifactType: string;
  storageUri: string;
  pilotRunStepId?: string | null;
  contentType?: string | null;
  checksum?: string | null;
  redactionState?: PilotArtifactRedactionState;
}

export async function createPilotArtifact(input: CreatePilotArtifactInput) {
  return prisma.pilotArtifact.create({
    data: {
      pilotRunId: input.pilotRunId,
      pilotRunStepId: input.pilotRunStepId ?? null,
      artifactType: input.artifactType,
      storageUri: input.storageUri,
      contentType: input.contentType ?? null,
      checksum: input.checksum ?? null,
      redactionState: input.redactionState ?? PilotArtifactRedactionState.SANITIZED,
    },
  });
}

export interface AcquirePilotExecutionLockInput {
  lockKey: string;
  lockScope: string;
  pilotRunId: string;
  expiresAt: Date;
  orgId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
}

export async function acquirePilotExecutionLock(input: AcquirePilotExecutionLockInput) {
  const existing = await prisma.pilotExecutionLock.findUnique({
    where: {
      lockKey: input.lockKey,
    },
  });

  if (existing) {
    return null;
  }

  try {
    return await prisma.pilotExecutionLock.create({
      data: {
        lockKey: input.lockKey,
        lockScope: input.lockScope,
        pilotRunId: input.pilotRunId,
        expiresAt: input.expiresAt,
        orgId: input.orgId ?? null,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return null;
    }

    throw error;
  }
}

export async function releasePilotExecutionLock(lockId: string, releasedAt = new Date()) {
  return prisma.pilotExecutionLock.update({
    where: { id: lockId },
    data: { releasedAt },
  });
}

export async function createPilotIncidentLink(input: { pilotRunId: string; incidentRef: string; linkType: string }) {
  return prisma.pilotIncidentLink.create({
    data: {
      pilotRunId: input.pilotRunId,
      incidentRef: input.incidentRef,
      linkType: input.linkType,
    },
  });
}

export interface CreateResourceNodeInput {
  nodeType: ResourceNodeType;
  displayName: string;
  externalId?: string | null;
  orgId?: string | null;
  product?: ProductKey | null;
  environment?: string | null;
  status?: string;
  metadata?: Record<string, unknown> | null;
}

export async function createResourceNode(input: CreateResourceNodeInput) {
  return prisma.resourceNode.create({
    data: {
      nodeType: input.nodeType,
      displayName: input.displayName,
      externalId: input.externalId ?? null,
      orgId: input.orgId ?? null,
      product: input.product ?? null,
      environment: input.environment ?? null,
      status: input.status ?? "unknown",
      metadata: toOptionalJson(input.metadata),
    },
  });
}

export async function createResourceEdge(input: {
  fromNodeId: string;
  toNodeId: string;
  relationshipType: ResourceRelationshipType;
  metadata?: Record<string, unknown> | null;
}) {
  return prisma.resourceEdge.create({
    data: {
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      relationshipType: input.relationshipType,
      metadata: toOptionalJson(input.metadata),
    },
  });
}

export async function recordServiceHealthSnapshot(input: {
  resourceNodeId: string;
  signalSource: string;
  healthState?: ServiceHealthState;
  latencyMs?: number | null;
  errorRate?: number | null;
  metadata?: Record<string, unknown> | null;
  measuredAt?: Date;
}) {
  return prisma.serviceHealthSnapshot.create({
    data: {
      resourceNodeId: input.resourceNodeId,
      signalSource: input.signalSource,
      healthState: input.healthState ?? ServiceHealthState.UNKNOWN,
      latencyMs: input.latencyMs ?? null,
      errorRate: input.errorRate ?? null,
      metadata: toOptionalJson(input.metadata),
      measuredAt: input.measuredAt ?? new Date(),
    },
  });
}

export interface CreateRunbookInput {
  name: string;
  slug: string;
  status?: string;
  ownerProduct?: ProductKey | null;
  serviceScope?: string | null;
  riskTier?: number;
  orgId?: string | null;
}

export async function createRunbook(input: CreateRunbookInput) {
  return prisma.runbook.create({
    data: {
      name: input.name,
      slug: input.slug,
      status: input.status ?? "draft",
      ownerProduct: input.ownerProduct ?? null,
      serviceScope: input.serviceScope ?? null,
      riskTier: input.riskTier ?? 1,
      orgId: input.orgId ?? null,
    },
  });
}

export interface PublishRunbookVersionInput {
  runbookId: string;
  version: string;
  definition: Record<string, unknown>;
  verificationDefinition?: Record<string, unknown> | null;
  rollbackDefinition?: Record<string, unknown> | null;
  publishedAt?: Date;
}

export async function publishRunbookVersion(input: PublishRunbookVersionInput) {
  return prisma.$transaction(async (tx) => {
    const publishedAt = input.publishedAt ?? new Date();

    await tx.runbookVersion.updateMany({
      where: {
        runbookId: input.runbookId,
        supersededAt: null,
      },
      data: {
        supersededAt: publishedAt,
      },
    });

    return tx.runbookVersion.create({
      data: {
        runbookId: input.runbookId,
        version: input.version,
        definition: toJsonValue(input.definition),
        verificationDefinition: toOptionalJson(input.verificationDefinition),
        rollbackDefinition: toOptionalJson(input.rollbackDefinition),
        publishedAt,
      },
    });
  });
}

export async function captureCommandDefinitionSnapshot(input: {
  pilotRunId: string;
  commandName: string;
  definition: Record<string, unknown>;
  registryVersion?: string | null;
}) {
  return prisma.commandDefinitionSnapshot.create({
    data: {
      pilotRunId: input.pilotRunId,
      commandName: input.commandName,
      registryVersion: input.registryVersion ?? null,
      definition: toJsonValue(input.definition),
    },
  });
}

export async function captureCapabilityDefinitionSnapshot(input: {
  pilotRunId: string;
  capabilityName: string;
  definition: Record<string, unknown>;
}) {
  return prisma.capabilityDefinitionSnapshot.create({
    data: {
      pilotRunId: input.pilotRunId,
      capabilityName: input.capabilityName,
      definition: toJsonValue(input.definition),
    },
  });
}

export async function getPilotRunWithTimeline(pilotRunId: string) {
  return prisma.pilotRun.findUnique({
    where: { id: pilotRunId },
    include: {
      steps: {
        orderBy: {
          sequence: "asc",
        },
      },
      events: {
        orderBy: {
          createdAt: "asc",
        },
      },
      policyDecisions: {
        orderBy: {
          createdAt: "asc",
        },
      },
      approvals: {
        orderBy: {
          requestedAt: "asc",
        },
      },
      artifacts: {
        orderBy: {
          createdAt: "asc",
        },
      },
      executionLocks: {
        orderBy: {
          acquiredAt: "asc",
        },
      },
      incidentLinks: {
        orderBy: {
          createdAt: "asc",
        },
      },
      commandSnapshots: {
        orderBy: {
          capturedAt: "asc",
        },
      },
      capabilitySnapshots: {
        orderBy: {
          capturedAt: "asc",
        },
      },
    },
  });
}

export async function getRunbookBySlug(slug: string) {
  return prisma.runbook.findUnique({
    where: { slug },
    include: {
      versions: {
        orderBy: {
          publishedAt: "desc",
        },
      },
    },
  });
}