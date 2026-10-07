import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { getDb } from "./db.js";

export const RETENTION_ENTITY_TYPES = [
  "AuditLog",
  "SecurityEvent",
  "UsageEvent",
  "PlatformEvent",
  "Notification",
] as const;

export const RETENTION_ACTIONS = ["DELETE", "ANONYMIZE"] as const;
export const RETENTION_SCOPES = ["PLATFORM", "ORGANIZATION"] as const;
export const INCIDENT_SEVERITIES = ["SEV1", "SEV2", "SEV3", "SEV4"] as const;
export const INCIDENT_STATUSES = [
  "OPEN",
  "INVESTIGATING",
  "MITIGATED",
  "RESOLVED",
  "POST_MORTEM",
  "CLOSED",
] as const;

export type RetentionEntityType = (typeof RETENTION_ENTITY_TYPES)[number];
export type RetentionAction = (typeof RETENTION_ACTIONS)[number];
export type RetentionScope = (typeof RETENTION_SCOPES)[number];
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

const RETENTION_BATCH_LIMIT = 10_000;

type RetentionEntitySpec = {
  table: RetentionEntityType;
  timestampColumn: "createdAt";
  orgColumn: "orgId";
  anonymizeColumns?: readonly string[];
};

const RETENTION_ENTITY_SPECS: Record<RetentionEntityType, RetentionEntitySpec> = {
  AuditLog: {
    table: "AuditLog",
    timestampColumn: "createdAt",
    orgColumn: "orgId",
    anonymizeColumns: ["userId", "ip", "userAgent"],
  },
  SecurityEvent: {
    table: "SecurityEvent",
    timestampColumn: "createdAt",
    orgColumn: "orgId",
    anonymizeColumns: ["userId", "ip", "userAgent", "country"],
  },
  UsageEvent: {
    table: "UsageEvent",
    timestampColumn: "createdAt",
    orgColumn: "orgId",
  },
  PlatformEvent: {
    table: "PlatformEvent",
    timestampColumn: "createdAt",
    orgColumn: "orgId",
  },
  Notification: {
    table: "Notification",
    timestampColumn: "createdAt",
    orgColumn: "orgId",
  },
};

const INCIDENT_TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  OPEN: ["INVESTIGATING", "MITIGATED", "RESOLVED", "CLOSED"],
  INVESTIGATING: ["MITIGATED", "RESOLVED", "CLOSED"],
  MITIGATED: ["INVESTIGATING", "RESOLVED", "CLOSED"],
  RESOLVED: ["INVESTIGATING", "POST_MORTEM", "CLOSED"],
  POST_MORTEM: ["INVESTIGATING", "CLOSED"],
  CLOSED: ["INVESTIGATING"],
};

function quoteIdentifier(value: string): string {
  return '"' + value.replaceAll('"', '""') + '"';
}

function cutoffDate(retentionDays: number): Date {
  return new Date(Date.now() - retentionDays * 86_400_000);
}

async function writeAudit(
  client: PoolClient,
  input: {
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    request: FastifyRequest;
    orgId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  await client.query(
    'INSERT INTO "AuditLog" (id,"userId","orgId",action,"entityType","entityId",ip,"userAgent",metadata,"createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,NOW())',
    [
      randomUUID(),
      input.actorId,
      input.orgId ?? null,
      input.action,
      input.entityType,
      input.entityId,
      input.request.ip ?? null,
      input.request.headers["user-agent"] ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

async function assertOrganization(client: PoolClient, orgId: string) {
  const result = await client.query('SELECT id FROM "Organization" WHERE id=$1', [orgId]);
  if (!result.rows[0]) {
    throw Object.assign(new Error("Organization not found"), { statusCode: 404 });
  }
}

async function assertUser(client: PoolClient, userId: string) {
  const result = await client.query('SELECT id FROM "User" WHERE id=$1', [userId]);
  if (!result.rows[0]) {
    throw Object.assign(new Error("Platform user not found"), { statusCode: 404 });
  }
}

async function assertRunbook(client: PoolClient, runbookId: string) {
  const result = await client.query('SELECT id FROM "ComplianceRunbook" WHERE id=$1', [
    runbookId,
  ]);
  if (!result.rows[0]) {
    throw Object.assign(new Error("Compliance runbook not found"), { statusCode: 404 });
  }
}

export async function getComplianceGovernanceSnapshot() {
  const db = getDb();
  const [policies, rules, runbooks, incidents, incidentSummary, organizations] = await Promise.all([
    db.query(
      `SELECT
         p.id,p."entityType",p."retentionDays",p.action::text AS action,
         p."isActive",p.scope::text AS scope,p."orgId",p.description,
         p."createdAt",p."updatedAt",
         COALESCE(
           json_agg(
             json_build_object(
               'id',e.id,
               'startedAt',e."startedAt",
               'completedAt',e."completedAt",
               'recordsAffected',e."recordsAffected",
               'error',e.error
             )
             ORDER BY e."startedAt" DESC
           ) FILTER (WHERE e.id IS NOT NULL),
           '[]'::json
         ) AS executions
       FROM "RetentionPolicy" p
       LEFT JOIN LATERAL (
         SELECT *
         FROM "RetentionExecution"
         WHERE "policyId"=p.id
         ORDER BY "startedAt" DESC
         LIMIT 5
       ) e ON TRUE
       GROUP BY p.id
       ORDER BY p."entityType",p.scope,p."createdAt"`,
    ),
    db.query(
      `SELECT
         id,name,description,"entityType","minRetentionDays",
         "preventDeletion","preventModification","requireApproval","isActive",
         "createdAt","updatedAt"
       FROM "AuditRetentionRule"
       ORDER BY "entityType",name`,
    ),
    db.query(
      `SELECT
         r.id,r.title,r.slug,r.category,r.content,r.version,r."isPublished",
         r."lastReviewAt",r."nextReviewAt",r."ownerId",r."createdAt",r."updatedAt",
         u.name AS "ownerName",u.email AS "ownerEmail",
         (SELECT count(*)::int FROM "IncidentRecord" i WHERE i."runbookId"=r.id) AS "incidentCount"
       FROM "ComplianceRunbook" r
       LEFT JOIN "User" u ON u.id=r."ownerId"
       ORDER BY r.category,r.title`,
    ),
    db.query(
      `SELECT
         i.id,i."orgId",i.title,i.severity::text AS severity,i.status::text AS status,
         i."runbookId",i.description,i.impact,i."rootCause",i.timeline,
         i."mitigationSteps",i."postMortemUrl",i."reportedById",i."assignedToId",
         i."detectedAt",i."mitigatedAt",i."resolvedAt",i."closedAt",
         i."createdAt",i."updatedAt",
         o.name AS "orgName",o.slug AS "orgSlug",
         r.title AS "runbookTitle",r.slug AS "runbookSlug",
         reporter.name AS "reportedByName",
         assignee.name AS "assignedToName"
       FROM "IncidentRecord" i
       LEFT JOIN "Organization" o ON o.id=i."orgId"
       LEFT JOIN "ComplianceRunbook" r ON r.id=i."runbookId"
       LEFT JOIN "User" reporter ON reporter.id=i."reportedById"
       LEFT JOIN "User" assignee ON assignee.id=i."assignedToId"
       ORDER BY
         CASE i.severity WHEN 'SEV1' THEN 1 WHEN 'SEV2' THEN 2 WHEN 'SEV3' THEN 3 ELSE 4 END,
         i."createdAt" DESC
       LIMIT 200`,
    ),
    db.query(
      `SELECT
         count(*) FILTER (WHERE status='OPEN')::int AS open,
         count(*) FILTER (WHERE status='INVESTIGATING')::int AS investigating,
         count(*) FILTER (WHERE status='MITIGATED')::int AS mitigated,
         count(*) FILTER (WHERE status='RESOLVED')::int AS resolved,
         count(*) FILTER (WHERE status='POST_MORTEM')::int AS post_mortem,
         count(*) FILTER (WHERE status='CLOSED')::int AS closed,
         count(*) FILTER (WHERE status<>'CLOSED' AND severity='SEV1')::int AS sev1_active,
         count(*) FILTER (WHERE status<>'CLOSED' AND severity='SEV2')::int AS sev2_active
       FROM "IncidentRecord"`,
    ),
    db.query(
      `SELECT id,name,slug,"isPlatformInternal"
       FROM "Organization"
       ORDER BY "isPlatformInternal" DESC,name ASC
       LIMIT 500`,
    ),
  ]);

  const dueRunbooks = runbooks.rows.filter((row) => {
    if (!row.isPublished) return false;
    if (!row.nextReviewAt) return true;
    return new Date(row.nextReviewAt).getTime() <= Date.now();
  }).length;

  return {
    retention: {
      policies: policies.rows,
      rules: rules.rows,
      supportedEntities: RETENTION_ENTITY_TYPES.map((entityType) => ({
        entityType,
        actions: RETENTION_ENTITY_SPECS[entityType].anonymizeColumns
          ? ["DELETE", "ANONYMIZE"]
          : ["DELETE"],
      })),
      execution: {
        batchLimit: RETENTION_BATCH_LIMIT,
        archiveReady: false,
      },
    },
    runbooks: runbooks.rows,
    incidents: incidents.rows,
    organizations: organizations.rows,
    incidentTransitions: INCIDENT_TRANSITIONS,
    metrics: {
      activeIncidents:
        Number(incidentSummary.rows[0]?.open ?? 0) +
        Number(incidentSummary.rows[0]?.investigating ?? 0) +
        Number(incidentSummary.rows[0]?.mitigated ?? 0),
      sev1Active: Number(incidentSummary.rows[0]?.sev1_active ?? 0),
      sev2Active: Number(incidentSummary.rows[0]?.sev2_active ?? 0),
      dueRunbooks,
      activeRetentionPolicies: policies.rows.filter((row) => row.isActive).length,
      activeAuditRules: rules.rows.filter((row) => row.isActive).length,
    },
    incidentSummary: incidentSummary.rows[0] ?? {},
  };
}

async function retentionRulesForEntity(client: PoolClient, entityType: string) {
  const result = await client.query(
    `SELECT
       id,name,"minRetentionDays","preventDeletion","preventModification",
       "requireApproval","isActive"
     FROM "AuditRetentionRule"
     WHERE "entityType"=$1 AND "isActive"=true
     ORDER BY "minRetentionDays" DESC`,
    [entityType],
  );
  return result.rows;
}

async function retentionPolicyById(client: PoolClient, policyId: string) {
  const result = await client.query(
    `SELECT
       id,"entityType","retentionDays",action::text AS action,"isActive",
       scope::text AS scope,"orgId",description,"createdAt","updatedAt"
     FROM "RetentionPolicy"
     WHERE id=$1`,
    [policyId],
  );
  const row = result.rows[0];
  if (!row) {
    throw Object.assign(new Error("Retention policy not found"), { statusCode: 404 });
  }
  return row;
}

async function validateRetentionPolicy(
  client: PoolClient,
  input: {
    entityType: RetentionEntityType;
    retentionDays: number;
    action: RetentionAction;
    scope: RetentionScope;
    orgId?: string | null;
    requireAuditRuleForAuditLog?: boolean;
  },
) {
  const spec = RETENTION_ENTITY_SPECS[input.entityType];
  if (input.action === "ANONYMIZE" && !spec.anonymizeColumns) {
    throw Object.assign(
      new Error(input.entityType + " does not have a safe anonymization contract"),
      { statusCode: 409 },
    );
  }
  if (input.scope === "ORGANIZATION" && !input.orgId) {
    throw Object.assign(new Error("Organization-scoped retention requires orgId"), {
      statusCode: 400,
    });
  }
  if (input.scope === "PLATFORM" && input.orgId) {
    throw Object.assign(new Error("Platform-scoped retention cannot include orgId"), {
      statusCode: 400,
    });
  }
  if (input.orgId) await assertOrganization(client, input.orgId);

  const rules = await retentionRulesForEntity(client, input.entityType);
  if (
    input.requireAuditRuleForAuditLog &&
    input.entityType === "AuditLog" &&
    input.action === "DELETE" &&
    rules.length === 0
  ) {
    throw Object.assign(
      new Error(
        "AuditLog deletion is blocked until an active immutable audit-retention rule exists",
      ),
      { statusCode: 409 },
    );
  }

  const blockingApproval = rules.find((rule) => rule.requireApproval);
  if (blockingApproval) {
    throw Object.assign(
      new Error(
        'Retention execution requires an approval workflow because rule "' +
          blockingApproval.name +
          '" requires approval',
      ),
      { statusCode: 409 },
    );
  }

  if (input.action === "DELETE") {
    const minimum = rules
      .filter((rule) => rule.preventDeletion)
      .reduce(
        (max, rule) => Math.max(max, Number(rule.minRetentionDays ?? 0)),
        0,
      );
    if (input.retentionDays < minimum) {
      throw Object.assign(
        new Error(
          "Retention period " +
            input.retentionDays +
            "d is below immutable minimum " +
            minimum +
            "d",
        ),
        { statusCode: 409 },
      );
    }
  }

  if (
    input.action === "ANONYMIZE" &&
    rules.some((rule) => rule.preventModification)
  ) {
    throw Object.assign(
      new Error("Active audit-retention policy prevents modification/anonymization"),
      { statusCode: 409 },
    );
  }

  return { spec, rules };
}

export async function createRetentionPolicy(input: {
  actorId: string;
  entityType: RetentionEntityType;
  retentionDays: number;
  action: RetentionAction;
  scope: RetentionScope;
  orgId?: string | null;
  description?: string | null;
  request: FastifyRequest;
}) {
  const db = getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await validateRetentionPolicy(client, {
      entityType: input.entityType,
      retentionDays: input.retentionDays,
      action: input.action,
      scope: input.scope,
      orgId: input.orgId ?? null,
    });

    const existing = await client.query(
      `SELECT id
       FROM "RetentionPolicy"
       WHERE "entityType"=$1 AND scope=$2::"SecretScope"
         AND (($3::text IS NULL AND "orgId" IS NULL) OR "orgId"=$3)
       LIMIT 1`,
      [input.entityType, input.scope, input.orgId ?? null],
    );
    if (existing.rows[0]) {
      throw Object.assign(
        new Error("A retention policy already exists for this entity and scope"),
        { statusCode: 409 },
      );
    }

    const id = randomUUID();
    const created = await client.query(
      `INSERT INTO "RetentionPolicy"
       (id,"entityType","retentionDays",action,"isActive",scope,"orgId",description,"createdAt","updatedAt")
       VALUES ($1,$2,$3,$4::"RetentionAction",true,$5::"SecretScope",$6,$7,NOW(),NOW())
       RETURNING id,"entityType","retentionDays",action::text AS action,"isActive",scope::text AS scope,"orgId",description,"createdAt","updatedAt"`,
      [
        id,
        input.entityType,
        input.retentionDays,
        input.action,
        input.scope,
        input.orgId ?? null,
        input.description ?? null,
      ],
    );

    await writeAudit(client, {
      actorId: input.actorId,
      orgId: input.orgId ?? null,
      action: "RETENTION_POLICY_CREATED",
      entityType: "RetentionPolicy",
      entityId: id,
      request: input.request,
      metadata: { policy: created.rows[0] },
    });
    await client.query("COMMIT");
    return created.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateRetentionPolicy(input: {
  actorId: string;
  policyId: string;
  retentionDays?: number;
  action?: RetentionAction;
  isActive?: boolean;
  description?: string | null;
  request: FastifyRequest;
}) {
  const db = getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const current = await retentionPolicyById(client, input.policyId);
    const retentionDays = input.retentionDays ?? Number(current.retentionDays);
    const action = input.action ?? (current.action as RetentionAction);

    await validateRetentionPolicy(client, {
      entityType: current.entityType as RetentionEntityType,
      retentionDays,
      action,
      scope: current.scope as RetentionScope,
      orgId: current.orgId,
    });

    const updated = await client.query(
      `UPDATE "RetentionPolicy"
       SET "retentionDays"=$1,action=$2::"RetentionAction",
           "isActive"=COALESCE($3,"isActive"),
           description=$4,
           "updatedAt"=NOW()
       WHERE id=$5
       RETURNING id,"entityType","retentionDays",action::text AS action,"isActive",scope::text AS scope,"orgId",description,"createdAt","updatedAt"`,
      [
        retentionDays,
        action,
        input.isActive ?? null,
        input.description !== undefined ? input.description : current.description,
        input.policyId,
      ],
    );

    await writeAudit(client, {
      actorId: input.actorId,
      orgId: current.orgId,
      action: "RETENTION_POLICY_UPDATED",
      entityType: "RetentionPolicy",
      entityId: input.policyId,
      request: input.request,
      metadata: { before: current, after: updated.rows[0] },
    });
    await client.query("COMMIT");
    return updated.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function retentionPredicate(
  spec: RetentionEntitySpec,
  scope: RetentionScope,
  orgId: string | null,
) {
  const timestamp = quoteIdentifier(spec.timestampColumn);
  const org = quoteIdentifier(spec.orgColumn);
  return {
    where:
      timestamp +
      " < $1" +
      (scope === "ORGANIZATION" ? " AND " + org + "=$2" : ""),
    values: scope === "ORGANIZATION" ? [orgId] : [],
  };
}

export async function previewRetentionPolicy(policyId: string) {
  const db = getDb();
  const client = await db.connect();
  try {
    const policy = await retentionPolicyById(client, policyId);
    const { spec, rules } = await validateRetentionPolicy(client, {
      entityType: policy.entityType as RetentionEntityType,
      retentionDays: Number(policy.retentionDays),
      action: policy.action as RetentionAction,
      scope: policy.scope as RetentionScope,
      orgId: policy.orgId,
      requireAuditRuleForAuditLog: true,
    });

    if (!policy.isActive) {
      throw Object.assign(new Error("Retention policy is inactive"), { statusCode: 409 });
    }

    const cutoff = cutoffDate(Number(policy.retentionDays));
    const predicate = retentionPredicate(
      spec,
      policy.scope as RetentionScope,
      policy.orgId,
    );
    const table = quoteIdentifier(spec.table);
    const count = await client.query(
      "SELECT count(*)::int AS count FROM " +
        table +
        " WHERE " +
        predicate.where,
      [cutoff, ...predicate.values],
    );

    return {
      policy,
      cutoff,
      eligibleRecords: Number(count.rows[0]?.count ?? 0),
      batchLimit: RETENTION_BATCH_LIMIT,
      rules,
    };
  } finally {
    client.release();
  }
}

export async function executeRetentionPolicy(input: {
  actorId: string;
  policyId: string;
  confirmEntityType: RetentionEntityType;
  reason: string;
  request: FastifyRequest;
}) {
  const db = getDb();
  const client = await db.connect();
  let executionId: string | null = null;
  let executionPolicy: Record<string, unknown> | null = null;
  const executionStartedAt = new Date();

  try {
    await client.query("BEGIN");
    const policy = await retentionPolicyById(client, input.policyId);
    executionPolicy = policy;
    if (policy.entityType !== input.confirmEntityType) {
      throw Object.assign(
        new Error("Retention confirmation does not match policy entity type"),
        { statusCode: 409 },
      );
    }
    if (!policy.isActive) {
      throw Object.assign(new Error("Retention policy is inactive"), { statusCode: 409 });
    }

    const { spec, rules } = await validateRetentionPolicy(client, {
      entityType: policy.entityType as RetentionEntityType,
      retentionDays: Number(policy.retentionDays),
      action: policy.action as RetentionAction,
      scope: policy.scope as RetentionScope,
      orgId: policy.orgId,
      requireAuditRuleForAuditLog: true,
    });

    executionId = randomUUID();
    await client.query(
      'INSERT INTO "RetentionExecution" (id,"policyId","startedAt","recordsAffected") VALUES ($1,$2,$3,0)',
      [executionId, input.policyId, executionStartedAt],
    );

    const cutoff = cutoffDate(Number(policy.retentionDays));
    const predicate = retentionPredicate(
      spec,
      policy.scope as RetentionScope,
      policy.orgId,
    );
    const table = quoteIdentifier(spec.table);
    const params = [cutoff, ...predicate.values, RETENTION_BATCH_LIMIT];
    const limitParam = "$" + params.length;
    let affected = 0;

    if (policy.action === "DELETE") {
      const deleted = await client.query(
        `WITH candidates AS (
           SELECT id FROM ${table}
           WHERE ${predicate.where}
           ORDER BY ${quoteIdentifier(spec.timestampColumn)} ASC
           LIMIT ${limitParam}
         )
         DELETE FROM ${table}
         WHERE id IN (SELECT id FROM candidates)
         RETURNING id`,
        params,
      );
      affected = deleted.rowCount ?? 0;
    } else if (policy.action === "ANONYMIZE" && spec.anonymizeColumns) {
      const assignments = spec.anonymizeColumns
        .map((column) => quoteIdentifier(column) + "=NULL")
        .join(",");
      const updated = await client.query(
        `WITH candidates AS (
           SELECT id FROM ${table}
           WHERE ${predicate.where}
           ORDER BY ${quoteIdentifier(spec.timestampColumn)} ASC
           LIMIT ${limitParam}
         )
         UPDATE ${table}
         SET ${assignments}
         WHERE id IN (SELECT id FROM candidates)
         RETURNING id`,
        params,
      );
      affected = updated.rowCount ?? 0;
    } else {
      throw Object.assign(new Error("Retention action is not executable"), {
        statusCode: 409,
      });
    }

    await client.query(
      'UPDATE "RetentionExecution" SET "completedAt"=NOW(),"recordsAffected"=$1,error=NULL WHERE id=$2',
      [affected, executionId],
    );

    await writeAudit(client, {
      actorId: input.actorId,
      orgId: policy.orgId,
      action: "RETENTION_POLICY_EXECUTED",
      entityType: "RetentionPolicy",
      entityId: input.policyId,
      request: input.request,
      metadata: {
        executionId,
        entityType: policy.entityType,
        action: policy.action,
        scope: policy.scope,
        retentionDays: policy.retentionDays,
        cutoff: cutoff.toISOString(),
        recordsAffected: affected,
        batchLimit: RETENTION_BATCH_LIMIT,
        reason: input.reason,
        activeRules: rules.map((rule) => ({
          id: rule.id,
          name: rule.name,
          minRetentionDays: rule.minRetentionDays,
        })),
      },
    });

    await client.query("COMMIT");
    return { executionId, recordsAffected: affected, batchLimit: RETENTION_BATCH_LIMIT };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original execution error.
    }

    if (executionId) {
      const message = error instanceof Error ? error.message : String(error);
      await db
        .query(
          `INSERT INTO "RetentionExecution"
           (id,"policyId","startedAt","completedAt","recordsAffected",error)
           VALUES ($1,$2,$3,NOW(),0,$4)
           ON CONFLICT (id)
           DO UPDATE SET "completedAt"=NOW(),error=EXCLUDED.error`,
          [executionId, input.policyId, executionStartedAt, message],
        )
        .catch(() => undefined);

      await db
        .query(
          'INSERT INTO "AuditLog" (id,"userId","orgId",action,"entityType","entityId",ip,"userAgent",metadata,"createdAt") VALUES ($1,$2,$3,\'RETENTION_POLICY_EXECUTION_FAILED\',\'RetentionPolicy\',$4,$5,$6,$7::jsonb,NOW())',
          [
            randomUUID(),
            input.actorId,
            (executionPolicy?.orgId as string | null | undefined) ?? null,
            input.policyId,
            input.request.ip ?? null,
            input.request.headers["user-agent"] ?? null,
            JSON.stringify({
              executionId,
              reason: input.reason,
              error: message,
            }),
          ],
        )
        .catch(() => undefined);
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function createAuditRetentionRule(input: {
  actorId: string;
  name: string;
  entityType: RetentionEntityType;
  description?: string | null;
  minRetentionDays: number;
  preventDeletion: boolean;
  preventModification: boolean;
  requireApproval: boolean;
  request: FastifyRequest;
}) {
  const db = getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const conflicting = await client.query(
      `SELECT id,"retentionDays",scope::text AS scope,"orgId"
       FROM "RetentionPolicy"
       WHERE "entityType"=$1 AND "isActive"=true AND action='DELETE'
         AND "retentionDays" < $2
       LIMIT 1`,
      [input.entityType, input.minRetentionDays],
    );
    if (conflicting.rows[0]) {
      throw Object.assign(
        new Error("An active retention policy is shorter than the proposed immutable minimum"),
        { statusCode: 409 },
      );
    }

    const id = randomUUID();
    const created = await client.query(
      `INSERT INTO "AuditRetentionRule"
       (id,name,description,"entityType","minRetentionDays","preventDeletion",
        "preventModification","requireApproval","isActive","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,NOW(),NOW())
       RETURNING *`,
      [
        id,
        input.name,
        input.description ?? null,
        input.entityType,
        input.minRetentionDays,
        input.preventDeletion,
        input.preventModification,
        input.requireApproval,
      ],
    );

    await writeAudit(client, {
      actorId: input.actorId,
      action: "AUDIT_RETENTION_RULE_CREATED",
      entityType: "AuditRetentionRule",
      entityId: id,
      request: input.request,
      metadata: { rule: created.rows[0] },
    });
    await client.query("COMMIT");
    return created.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateAuditRetentionRule(input: {
  actorId: string;
  ruleId: string;
  name?: string;
  description?: string | null;
  minRetentionDays?: number;
  preventDeletion?: boolean;
  preventModification?: boolean;
  requireApproval?: boolean;
  isActive?: boolean;
  request: FastifyRequest;
}) {
  const db = getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query('SELECT * FROM "AuditRetentionRule" WHERE id=$1', [
      input.ruleId,
    ]);
    const current = found.rows[0];
    if (!current) {
      throw Object.assign(new Error("Audit retention rule not found"), { statusCode: 404 });
    }

    const minRetentionDays =
      input.minRetentionDays ?? Number(current.minRetentionDays);
    const willBeActive = input.isActive ?? current.isActive;
    const preventDeletion = input.preventDeletion ?? current.preventDeletion;

    if (willBeActive && preventDeletion) {
      const conflicting = await client.query(
        `SELECT id
         FROM "RetentionPolicy"
         WHERE "entityType"=$1 AND "isActive"=true AND action='DELETE'
           AND "retentionDays" < $2
         LIMIT 1`,
        [current.entityType, minRetentionDays],
      );
      if (conflicting.rows[0]) {
        throw Object.assign(
          new Error("An active retention policy is shorter than the proposed immutable minimum"),
          { statusCode: 409 },
        );
      }
    }

    const updated = await client.query(
      `UPDATE "AuditRetentionRule"
       SET name=COALESCE($1,name),
           description=$2,
           "minRetentionDays"=$3,
           "preventDeletion"=COALESCE($4,"preventDeletion"),
           "preventModification"=COALESCE($5,"preventModification"),
           "requireApproval"=COALESCE($6,"requireApproval"),
           "isActive"=COALESCE($7,"isActive"),
           "updatedAt"=NOW()
       WHERE id=$8
       RETURNING *`,
      [
        input.name ?? null,
        input.description !== undefined ? input.description : current.description,
        minRetentionDays,
        input.preventDeletion ?? null,
        input.preventModification ?? null,
        input.requireApproval ?? null,
        input.isActive ?? null,
        input.ruleId,
      ],
    );

    await writeAudit(client, {
      actorId: input.actorId,
      action: "AUDIT_RETENTION_RULE_UPDATED",
      entityType: "AuditRetentionRule",
      entityId: input.ruleId,
      request: input.request,
      metadata: { before: current, after: updated.rows[0] },
    });
    await client.query("COMMIT");
    return updated.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function createComplianceRunbook(input: {
  actorId: string;
  title: string;
  slug: string;
  category: string;
  content: string;
  ownerId?: string | null;
  request: FastifyRequest;
}) {
  const db = getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    if (input.ownerId) await assertUser(client, input.ownerId);

    const id = randomUUID();
    const created = await client.query(
      `INSERT INTO "ComplianceRunbook"
       (id,title,slug,category,content,version,"isPublished","ownerId","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,1,false,$6,NOW(),NOW())
       RETURNING *`,
      [
        id,
        input.title,
        input.slug,
        input.category,
        input.content,
        input.ownerId ?? null,
      ],
    );

    await writeAudit(client, {
      actorId: input.actorId,
      action: "COMPLIANCE_RUNBOOK_CREATED",
      entityType: "ComplianceRunbook",
      entityId: id,
      request: input.request,
      metadata: {
        title: input.title,
        slug: input.slug,
        category: input.category,
      },
    });
    await client.query("COMMIT");
    return created.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateComplianceRunbook(input: {
  actorId: string;
  runbookId: string;
  title?: string;
  category?: string;
  content?: string;
  isPublished?: boolean;
  ownerId?: string | null;
  request: FastifyRequest;
}) {
  const db = getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query('SELECT * FROM "ComplianceRunbook" WHERE id=$1', [
      input.runbookId,
    ]);
    const current = found.rows[0];
    if (!current) {
      throw Object.assign(new Error("Compliance runbook not found"), { statusCode: 404 });
    }
    if (input.ownerId) await assertUser(client, input.ownerId);

    const updated = await client.query(
      `UPDATE "ComplianceRunbook"
       SET title=COALESCE($1,title),
           category=COALESCE($2,category),
           content=COALESCE($3,content),
           version=CASE WHEN $3::text IS NULL OR $3=content THEN version ELSE version+1 END,
           "isPublished"=COALESCE($4,"isPublished"),
           "ownerId"=$5,
           "updatedAt"=NOW()
       WHERE id=$6
       RETURNING *`,
      [
        input.title ?? null,
        input.category ?? null,
        input.content ?? null,
        input.isPublished ?? null,
        input.ownerId !== undefined ? input.ownerId : current.ownerId,
        input.runbookId,
      ],
    );

    await writeAudit(client, {
      actorId: input.actorId,
      action: "COMPLIANCE_RUNBOOK_UPDATED",
      entityType: "ComplianceRunbook",
      entityId: input.runbookId,
      request: input.request,
      metadata: {
        before: {
          title: current.title,
          category: current.category,
          version: current.version,
          isPublished: current.isPublished,
          ownerId: current.ownerId,
        },
        after: {
          title: updated.rows[0].title,
          category: updated.rows[0].category,
          version: updated.rows[0].version,
          isPublished: updated.rows[0].isPublished,
          ownerId: updated.rows[0].ownerId,
        },
      },
    });
    await client.query("COMMIT");
    return updated.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function reviewComplianceRunbook(input: {
  actorId: string;
  runbookId: string;
  nextReviewDays: number;
  request: FastifyRequest;
}) {
  const db = getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const nextReview = new Date(Date.now() + input.nextReviewDays * 86_400_000);
    const updated = await client.query(
      `UPDATE "ComplianceRunbook"
       SET "lastReviewAt"=NOW(),"nextReviewAt"=$1,"updatedAt"=NOW()
       WHERE id=$2
       RETURNING *`,
      [nextReview, input.runbookId],
    );
    if (!updated.rows[0]) {
      throw Object.assign(new Error("Compliance runbook not found"), { statusCode: 404 });
    }

    await writeAudit(client, {
      actorId: input.actorId,
      action: "COMPLIANCE_RUNBOOK_REVIEWED",
      entityType: "ComplianceRunbook",
      entityId: input.runbookId,
      request: input.request,
      metadata: { nextReviewDays: input.nextReviewDays, nextReviewAt: nextReview.toISOString() },
    });
    await client.query("COMMIT");
    return updated.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function normalizeTimeline(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .slice(-200) as Array<Record<string, unknown>>;
}

export async function createIncidentRecord(input: {
  actorId: string;
  orgId?: string | null;
  title: string;
  severity: IncidentSeverity;
  runbookId?: string | null;
  description?: string | null;
  impact?: string | null;
  assignedToId?: string | null;
  request: FastifyRequest;
}) {
  const db = getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    if (input.orgId) await assertOrganization(client, input.orgId);
    if (input.runbookId) await assertRunbook(client, input.runbookId);
    if (input.assignedToId) await assertUser(client, input.assignedToId);

    const id = randomUUID();
    const timeline = [
      {
        at: new Date().toISOString(),
        actorId: input.actorId,
        event: "INCIDENT_CREATED",
        status: "OPEN",
      },
    ];
    const created = await client.query(
      `INSERT INTO "IncidentRecord"
       (id,"orgId",title,severity,status,"runbookId",description,impact,timeline,
        "reportedById","assignedToId","detectedAt","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4::"IncidentSeverity",'OPEN',$5,$6,$7,$8::jsonb,$9,$10,NOW(),NOW(),NOW())
       RETURNING *`,
      [
        id,
        input.orgId ?? null,
        input.title,
        input.severity,
        input.runbookId ?? null,
        input.description ?? null,
        input.impact ?? null,
        JSON.stringify(timeline),
        input.actorId,
        input.assignedToId ?? null,
      ],
    );

    await writeAudit(client, {
      actorId: input.actorId,
      orgId: input.orgId ?? null,
      action: "INCIDENT_CREATED",
      entityType: "IncidentRecord",
      entityId: id,
      request: input.request,
      metadata: { severity: input.severity, title: input.title },
    });
    await client.query("COMMIT");
    return created.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateIncidentRecord(input: {
  actorId: string;
  incidentId: string;
  status?: IncidentStatus;
  severity?: IncidentSeverity;
  runbookId?: string | null;
  impact?: string | null;
  rootCause?: string | null;
  mitigationSteps?: string | null;
  postMortemUrl?: string | null;
  assignedToId?: string | null;
  note?: string | null;
  request: FastifyRequest;
}) {
  const db = getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query('SELECT * FROM "IncidentRecord" WHERE id=$1', [
      input.incidentId,
    ]);
    const current = found.rows[0];
    if (!current) {
      throw Object.assign(new Error("Incident not found"), { statusCode: 404 });
    }
    if (input.runbookId) await assertRunbook(client, input.runbookId);
    if (input.assignedToId) await assertUser(client, input.assignedToId);

    const nextStatus = (input.status ?? current.status) as IncidentStatus;
    if (
      input.status &&
      input.status !== current.status &&
      !INCIDENT_TRANSITIONS[current.status as IncidentStatus].includes(input.status)
    ) {
      throw Object.assign(
        new Error("Invalid incident transition: " + current.status + " -> " + input.status),
        { statusCode: 409 },
      );
    }

    const timeline = normalizeTimeline(current.timeline);
    if (input.status && input.status !== current.status) {
      timeline.push({
        at: new Date().toISOString(),
        actorId: input.actorId,
        event: "STATUS_CHANGED",
        from: current.status,
        to: input.status,
        ...(input.note ? { note: input.note } : {}),
      });
    } else if (input.note) {
      timeline.push({
        at: new Date().toISOString(),
        actorId: input.actorId,
        event: "NOTE_ADDED",
        note: input.note,
      });
    }

    const reopening = current.status === "CLOSED" && nextStatus === "INVESTIGATING";
    const updated = await client.query(
      `UPDATE "IncidentRecord"
       SET status=$1::"IncidentStatus",
           severity=COALESCE($2::"IncidentSeverity",severity),
           "runbookId"=$3,
           impact=$4,
           "rootCause"=$5,
           "mitigationSteps"=$6,
           "postMortemUrl"=$7,
           "assignedToId"=$8,
           timeline=$9::jsonb,
           "mitigatedAt"=CASE WHEN $1='MITIGATED' THEN COALESCE("mitigatedAt",NOW()) WHEN $10 THEN NULL ELSE "mitigatedAt" END,
           "resolvedAt"=CASE WHEN $1='RESOLVED' THEN COALESCE("resolvedAt",NOW()) WHEN $10 THEN NULL ELSE "resolvedAt" END,
           "closedAt"=CASE WHEN $1='CLOSED' THEN COALESCE("closedAt",NOW()) WHEN $10 THEN NULL ELSE "closedAt" END,
           "updatedAt"=NOW()
       WHERE id=$11
       RETURNING *`,
      [
        nextStatus,
        input.severity ?? null,
        input.runbookId !== undefined ? input.runbookId : current.runbookId,
        input.impact !== undefined ? input.impact : current.impact,
        input.rootCause !== undefined ? input.rootCause : current.rootCause,
        input.mitigationSteps !== undefined
          ? input.mitigationSteps
          : current.mitigationSteps,
        input.postMortemUrl !== undefined
          ? input.postMortemUrl
          : current.postMortemUrl,
        input.assignedToId !== undefined
          ? input.assignedToId
          : current.assignedToId,
        JSON.stringify(timeline.slice(-200)),
        reopening,
        input.incidentId,
      ],
    );

    await writeAudit(client, {
      actorId: input.actorId,
      orgId: current.orgId,
      action:
        input.status && input.status !== current.status
          ? "INCIDENT_STATUS_" + input.status
          : "INCIDENT_UPDATED",
      entityType: "IncidentRecord",
      entityId: input.incidentId,
      request: input.request,
      metadata: {
        previousStatus: current.status,
        status: nextStatus,
        severity: input.severity ?? current.severity,
        note: input.note ?? null,
      },
    });
    await client.query("COMMIT");
    return updated.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
