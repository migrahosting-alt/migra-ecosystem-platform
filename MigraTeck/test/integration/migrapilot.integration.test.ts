import {
  PilotApprovalStatus,
  PilotArtifactRedactionState,
  PilotPolicyDecisionResult,
  PilotRunStatus,
  PilotRunStepStatus,
  PilotVerificationState,
  ProductKey,
  ResourceNodeType,
  ResourceRelationshipType,
  ServiceHealthState,
} from "@prisma/client";
import { beforeEach, describe, expect, test } from "vitest";
import {
  acquirePilotExecutionLock,
  appendPilotEvent,
  captureCapabilityDefinitionSnapshot,
  captureCommandDefinitionSnapshot,
  createPilotApproval,
  createPilotArtifact,
  createPilotIncidentLink,
  createPilotRun,
  createPilotRunStep,
  createResourceEdge,
  createResourceNode,
  createRunbook,
  getPilotRunWithTimeline,
  getRunbookBySlug,
  publishRunbookVersion,
  recordPilotPolicyDecision,
  recordServiceHealthSnapshot,
  releasePilotExecutionLock,
} from "../../src/lib/migrapilot";
import { createOrganization, createUser, resetDatabase } from "../helpers/fixtures";
import { prisma } from "../helpers/prisma";

describe("MigraPilot integration", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("persists a pilot run timeline with approvals, artifacts, snapshots, and lock lifecycle", async () => {
    const actor = await createUser({
      email: "pilot-operator@example.com",
      password: "PilotOperator123!",
      emailVerified: true,
    });

    const approver = await createUser({
      email: "pilot-approver@example.com",
      password: "PilotApprover123!",
      emailVerified: true,
    });

    const org = await createOrganization({
      name: "MigraPilot Ops Org",
      slug: "migrapilot-ops-org",
      createdById: actor.id,
    });

    const run = await createPilotRun({
      source: "console",
      actorUserId: actor.id,
      orgId: org.id,
      environment: "production",
      intent: "restart panel-api after route deploy",
      commandName: "restart-migrapanel-panel-api",
      riskTier: 2,
      status: PilotRunStatus.AWAITING_APPROVAL,
      verificationState: PilotVerificationState.PENDING,
      correlationId: "corr-pilot-run-1",
      summary: "Controlled restart for panel-api after route deployment.",
    });

    const step = await createPilotRunStep({
      pilotRunId: run.id,
      sequence: 10,
      stepType: "command",
      title: "Restart panel-api",
      description: "Restart the API process through PM2.",
      status: PilotRunStepStatus.READY,
      targetType: "service",
      targetId: "panel-api",
    });

    await appendPilotEvent({
      pilotRunId: run.id,
      pilotRunStepId: step.id,
      eventType: "validation",
      message: "Pre-flight checks completed.",
      severity: "info",
      metadata: { checks: ["pm2-status", "health-endpoint"] },
    });

    await recordPilotPolicyDecision({
      pilotRunId: run.id,
      policyName: "production-restart-guardrail",
      decision: PilotPolicyDecisionResult.REQUIRE_APPROVAL,
      reason: "Production restart requires operator approval.",
      riskTier: 2,
      requiresApproval: true,
      metadata: { environment: "production" },
    });

    await createPilotApproval({
      pilotRunId: run.id,
      approvalType: "operator",
      status: PilotApprovalStatus.APPROVED,
      requestedByUserId: actor.id,
      approverUserId: approver.id,
      reason: "Validated by operations owner.",
      riskSummary: "API restart with low rollback complexity.",
      blastRadiusSummary: "Public panel API only.",
      rollbackPlanSummary: "Restart previous PM2 process profile.",
      verificationPlanSummary: "Verify health endpoint and logs.",
      decidedAt: new Date(),
    });

    await createPilotArtifact({
      pilotRunId: run.id,
      pilotRunStepId: step.id,
      artifactType: "log",
      storageUri: "s3://migrapilot-artifacts/runs/run-1/restart.log",
      contentType: "text/plain",
      checksum: "sha256-run-log",
      redactionState: PilotArtifactRedactionState.SANITIZED,
    });

    const lock = await acquirePilotExecutionLock({
      lockKey: `service:${org.id}:panel-api`,
      lockScope: "service",
      orgId: org.id,
      targetType: "service",
      targetId: "panel-api",
      pilotRunId: run.id,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    expect(lock).toBeTruthy();

    const duplicateLock = await acquirePilotExecutionLock({
      lockKey: `service:${org.id}:panel-api`,
      lockScope: "service",
      orgId: org.id,
      targetType: "service",
      targetId: "panel-api",
      pilotRunId: run.id,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    expect(duplicateLock).toBeNull();

    await createPilotIncidentLink({
      pilotRunId: run.id,
      incidentRef: "INC-2026-03-17-001",
      linkType: "change-window",
    });

    await captureCommandDefinitionSnapshot({
      pilotRunId: run.id,
      commandName: "restart-migrapanel-panel-api",
      registryVersion: "2026-03-17",
      definition: {
        kind: "command",
        target: "panel-api",
      },
    });

    await captureCapabilityDefinitionSnapshot({
      pilotRunId: run.id,
      capabilityName: "service-restart",
      definition: {
        scope: "platform",
        requiresApproval: true,
      },
    });

    await releasePilotExecutionLock(lock!.id);

    const timeline = await getPilotRunWithTimeline(run.id);
    expect(timeline?.steps).toHaveLength(1);
    expect(timeline?.events).toHaveLength(1);
    expect(timeline?.policyDecisions[0]?.decision).toBe(PilotPolicyDecisionResult.REQUIRE_APPROVAL);
    expect(timeline?.approvals[0]?.status).toBe(PilotApprovalStatus.APPROVED);
    expect(timeline?.artifacts[0]?.artifactType).toBe("log");
    expect(timeline?.executionLocks[0]?.releasedAt).toBeTruthy();
    expect(timeline?.incidentLinks[0]?.incidentRef).toBe("INC-2026-03-17-001");
    expect(timeline?.commandSnapshots[0]?.commandName).toBe("restart-migrapanel-panel-api");
    expect(timeline?.capabilitySnapshots[0]?.capabilityName).toBe("service-restart");
  });

  test("persists runbooks and resource graph state for MigraPilot operations", async () => {
    const owner = await createUser({
      email: "pilot-owner@example.com",
      password: "PilotOwner123!",
      emailVerified: true,
    });

    const org = await createOrganization({
      name: "MigraPilot Graph Org",
      slug: "migrapilot-graph-org",
      createdById: owner.id,
    });

    const runbook = await createRunbook({
      name: "Panel API Restart",
      slug: "panel-api-restart",
      ownerProduct: ProductKey.MIGRAPILOT,
      serviceScope: "panel-api",
      riskTier: 2,
      orgId: org.id,
    });

    await publishRunbookVersion({
      runbookId: runbook.id,
      version: "2026.03.17",
      definition: {
        steps: [{ sequence: 10, title: "Restart service" }],
      },
      verificationDefinition: {
        checks: ["health", "logs"],
      },
      rollbackDefinition: {
        steps: ["restart-previous-process"],
      },
    });

    const serviceNode = await createResourceNode({
      nodeType: ResourceNodeType.SERVICE,
      displayName: "panel-api",
      externalId: "svc-panel-api",
      orgId: org.id,
      product: ProductKey.MIGRAPANEL,
      environment: "production",
      status: "online",
      metadata: { host: "migrapanel-core" },
    });

    const infraNode = await createResourceNode({
      nodeType: ResourceNodeType.INFRASTRUCTURE_NODE,
      displayName: "migrapanel-core",
      externalId: "node-migrapanel-core",
      orgId: org.id,
      environment: "production",
      status: "healthy",
    });

    await createResourceEdge({
      fromNodeId: serviceNode.id,
      toNodeId: infraNode.id,
      relationshipType: ResourceRelationshipType.RUNS_ON,
      metadata: { managedBy: "pm2" },
    });

    await recordServiceHealthSnapshot({
      resourceNodeId: serviceNode.id,
      signalSource: "smoke-status",
      healthState: ServiceHealthState.HEALTHY,
      latencyMs: 42,
      errorRate: 0,
      metadata: { endpoint: "/api/health" },
    });

    const storedRunbook = await getRunbookBySlug("panel-api-restart");
    expect(storedRunbook?.versions).toHaveLength(1);
    expect(storedRunbook?.ownerProduct).toBe(ProductKey.MIGRAPILOT);

    const storedEdge = await prisma.resourceEdge.findFirst({
      where: {
        fromNodeId: serviceNode.id,
        toNodeId: infraNode.id,
      },
    });
    expect(storedEdge?.relationshipType).toBe(ResourceRelationshipType.RUNS_ON);

    const storedHealth = await prisma.serviceHealthSnapshot.findFirst({
      where: {
        resourceNodeId: serviceNode.id,
      },
      orderBy: {
        measuredAt: "desc",
      },
    });
    expect(storedHealth?.healthState).toBe(ServiceHealthState.HEALTHY);
  });
});
