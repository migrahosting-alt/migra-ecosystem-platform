import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePlatformAuthority } from "../../../lib/migraauth.js";
import {
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  RETENTION_ACTIONS,
  RETENTION_ENTITY_TYPES,
  RETENTION_SCOPES,
  createAuditRetentionRule,
  createComplianceRunbook,
  createIncidentRecord,
  createRetentionPolicy,
  executeRetentionPolicy,
  getComplianceGovernanceSnapshot,
  previewRetentionPolicy,
  reviewComplianceRunbook,
  updateAuditRetentionRule,
  updateComplianceRunbook,
  updateIncidentRecord,
  updateRetentionPolicy,
} from "../../../lib/compliance-governance.js";

const idParams = z.object({
  id: z.string().trim().min(1).max(160),
});

const createRetentionSchema = z.object({
  entityType: z.enum(RETENTION_ENTITY_TYPES),
  retentionDays: z.number().int().min(1).max(3650),
  action: z.enum(RETENTION_ACTIONS),
  scope: z.enum(RETENTION_SCOPES).default("PLATFORM"),
  orgId: z.string().trim().min(1).max(160).nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
});

const updateRetentionSchema = z
  .object({
    retentionDays: z.number().int().min(1).max(3650).optional(),
    action: z.enum(RETENTION_ACTIONS).optional(),
    isActive: z.boolean().optional(),
    description: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one retention setting must be provided.",
  });

const executeRetentionSchema = z.object({
  confirmEntityType: z.enum(RETENTION_ENTITY_TYPES),
  reason: z.string().trim().min(10).max(1000),
});

const createAuditRuleSchema = z.object({
  name: z.string().trim().min(2).max(160),
  entityType: z.enum(RETENTION_ENTITY_TYPES),
  description: z.string().trim().max(1000).nullable().optional(),
  minRetentionDays: z.number().int().min(1).max(3650),
  preventDeletion: z.boolean().default(true),
  preventModification: z.boolean().default(true),
  requireApproval: z.boolean().default(false),
});

const updateAuditRuleSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    minRetentionDays: z.number().int().min(1).max(3650).optional(),
    preventDeletion: z.boolean().optional(),
    preventModification: z.boolean().optional(),
    requireApproval: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one audit-retention setting must be provided.",
  });

const runbookSlug = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Runbook slug must be lowercase kebab-case.");

const createRunbookSchema = z.object({
  title: z.string().trim().min(3).max(200),
  slug: runbookSlug,
  category: z.string().trim().min(2).max(80),
  content: z.string().trim().min(20).max(100_000),
});

const updateRunbookSchema = z
  .object({
    title: z.string().trim().min(3).max(200).optional(),
    category: z.string().trim().min(2).max(80).optional(),
    content: z.string().trim().min(20).max(100_000).optional(),
    isPublished: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one runbook setting must be provided.",
  });

const reviewRunbookSchema = z.object({
  nextReviewDays: z.number().int().min(7).max(365).default(90),
});

const createIncidentSchema = z.object({
  orgId: z.string().trim().min(1).max(160).nullable().optional(),
  title: z.string().trim().min(3).max(240),
  severity: z.enum(INCIDENT_SEVERITIES),
  runbookId: z.string().trim().min(1).max(160).nullable().optional(),
  description: z.string().trim().max(10_000).nullable().optional(),
  impact: z.string().trim().max(10_000).nullable().optional(),
  assignToSelf: z.boolean().default(true),
});

const updateIncidentSchema = z
  .object({
    status: z.enum(INCIDENT_STATUSES).optional(),
    severity: z.enum(INCIDENT_SEVERITIES).optional(),
    runbookId: z.string().trim().min(1).max(160).nullable().optional(),
    impact: z.string().trim().max(10_000).nullable().optional(),
    rootCause: z.string().trim().max(20_000).nullable().optional(),
    mitigationSteps: z.string().trim().max(20_000).nullable().optional(),
    postMortemUrl: z.string().trim().url().max(2000).nullable().optional(),
    note: z.string().trim().max(4000).nullable().optional(),
    assignment: z.enum(["KEEP", "SELF", "UNASSIGN"]).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one incident setting must be provided.",
  });

export async function registerComplianceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/compliance/governance", async (request) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.compliance.read",
    ]);
    return {
      authority: {
        roles: authority.roles,
        permissions: authority.permissions.filter((permission) =>
          permission.startsWith("platform.compliance."),
        ),
        viaBootstrap: authority.viaBootstrap,
        canManage: authority.permissions.includes("platform.compliance.manage"),
        canManageRetention: authority.permissions.includes(
          "platform.compliance.retention.manage",
        ),
      },
      ...(await getComplianceGovernanceSnapshot()),
    };
  });

  app.post("/compliance/retention/policies", async (request, reply) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.compliance.retention.manage",
    ]);
    const body = createRetentionSchema.parse(request.body);
    const policy = await createRetentionPolicy({
      actorId: authority.platformUserId,
      entityType: body.entityType,
      retentionDays: body.retentionDays,
      action: body.action,
      scope: body.scope,
      orgId: body.orgId ?? null,
      description: body.description ?? null,
      request,
    });
    return reply.code(201).send({ policy });
  });

  app.patch("/compliance/retention/policies/:id", async (request) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.compliance.retention.manage",
    ]);
    const { id } = idParams.parse(request.params);
    const body = updateRetentionSchema.parse(request.body);
    return {
      policy: await updateRetentionPolicy({
        actorId: authority.platformUserId,
        policyId: id,
        ...(body.retentionDays !== undefined
          ? { retentionDays: body.retentionDays }
          : {}),
        ...(body.action !== undefined ? { action: body.action } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.description !== undefined
          ? { description: body.description }
          : {}),
        request,
      }),
    };
  });

  app.get("/compliance/retention/policies/:id/preview", async (request) => {
    await requirePlatformAuthority(request, ["platform.compliance.read"]);
    const { id } = idParams.parse(request.params);
    return previewRetentionPolicy(id);
  });

  app.post("/compliance/retention/policies/:id/execute", async (request) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.compliance.retention.manage",
    ]);
    const { id } = idParams.parse(request.params);
    const body = executeRetentionSchema.parse(request.body);
    return executeRetentionPolicy({
      actorId: authority.platformUserId,
      policyId: id,
      confirmEntityType: body.confirmEntityType,
      reason: body.reason,
      request,
    });
  });

  app.post("/compliance/audit-rules", async (request, reply) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.compliance.retention.manage",
    ]);
    const body = createAuditRuleSchema.parse(request.body);
    const rule = await createAuditRetentionRule({
      actorId: authority.platformUserId,
      name: body.name,
      entityType: body.entityType,
      description: body.description ?? null,
      minRetentionDays: body.minRetentionDays,
      preventDeletion: body.preventDeletion,
      preventModification: body.preventModification,
      requireApproval: body.requireApproval,
      request,
    });
    return reply.code(201).send({ rule });
  });

  app.patch("/compliance/audit-rules/:id", async (request) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.compliance.retention.manage",
    ]);
    const { id } = idParams.parse(request.params);
    const body = updateAuditRuleSchema.parse(request.body);
    return {
      rule: await updateAuditRetentionRule({
        actorId: authority.platformUserId,
        ruleId: id,
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined
          ? { description: body.description }
          : {}),
        ...(body.minRetentionDays !== undefined
          ? { minRetentionDays: body.minRetentionDays }
          : {}),
        ...(body.preventDeletion !== undefined
          ? { preventDeletion: body.preventDeletion }
          : {}),
        ...(body.preventModification !== undefined
          ? { preventModification: body.preventModification }
          : {}),
        ...(body.requireApproval !== undefined
          ? { requireApproval: body.requireApproval }
          : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        request,
      }),
    };
  });

  app.post("/compliance/runbooks", async (request, reply) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.compliance.manage",
    ]);
    const body = createRunbookSchema.parse(request.body);
    const runbook = await createComplianceRunbook({
      actorId: authority.platformUserId,
      title: body.title,
      slug: body.slug,
      category: body.category,
      content: body.content,
      ownerId: authority.platformUserId,
      request,
    });
    return reply.code(201).send({ runbook });
  });

  app.patch("/compliance/runbooks/:id", async (request) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.compliance.manage",
    ]);
    const { id } = idParams.parse(request.params);
    const body = updateRunbookSchema.parse(request.body);
    return {
      runbook: await updateComplianceRunbook({
        actorId: authority.platformUserId,
        runbookId: id,
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.category !== undefined ? { category: body.category } : {}),
        ...(body.content !== undefined ? { content: body.content } : {}),
        ...(body.isPublished !== undefined
          ? { isPublished: body.isPublished }
          : {}),
        request,
      }),
    };
  });

  app.post("/compliance/runbooks/:id/review", async (request) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.compliance.manage",
    ]);
    const { id } = idParams.parse(request.params);
    const body = reviewRunbookSchema.parse(request.body);
    return {
      runbook: await reviewComplianceRunbook({
        actorId: authority.platformUserId,
        runbookId: id,
        nextReviewDays: body.nextReviewDays,
        request,
      }),
    };
  });

  app.post("/compliance/incidents", async (request, reply) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.compliance.manage",
    ]);
    const body = createIncidentSchema.parse(request.body);
    const incident = await createIncidentRecord({
      actorId: authority.platformUserId,
      orgId: body.orgId ?? null,
      title: body.title,
      severity: body.severity,
      runbookId: body.runbookId ?? null,
      description: body.description ?? null,
      impact: body.impact ?? null,
      assignedToId: body.assignToSelf ? authority.platformUserId : null,
      request,
    });
    return reply.code(201).send({ incident });
  });

  app.patch("/compliance/incidents/:id", async (request) => {
    const authority = await requirePlatformAuthority(request, [
      "platform.compliance.manage",
    ]);
    const { id } = idParams.parse(request.params);
    const body = updateIncidentSchema.parse(request.body);
    return {
      incident: await updateIncidentRecord({
        actorId: authority.platformUserId,
        incidentId: id,
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.severity !== undefined ? { severity: body.severity } : {}),
        ...(body.runbookId !== undefined ? { runbookId: body.runbookId } : {}),
        ...(body.impact !== undefined ? { impact: body.impact } : {}),
        ...(body.rootCause !== undefined ? { rootCause: body.rootCause } : {}),
        ...(body.mitigationSteps !== undefined
          ? { mitigationSteps: body.mitigationSteps }
          : {}),
        ...(body.postMortemUrl !== undefined
          ? { postMortemUrl: body.postMortemUrl }
          : {}),
        ...(body.note !== undefined ? { note: body.note } : {}),
        ...(body.assignment === "SELF"
          ? { assignedToId: authority.platformUserId }
          : body.assignment === "UNASSIGN"
            ? { assignedToId: null }
            : {}),
        request,
      }),
    };
  });
}
