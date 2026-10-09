"use strict";

import { getDb } from "./db.js";

export type CommerceAuditFamily =
  | "billing"
  | "entitlement"
  | "provisioning"
  | "revenue"
  | "usage";

export type CommerceAuditQuery = {
  family?: CommerceAuditFamily;
  action?: string;
  orgId?: string;
  actorId?: string;
  q?: string;
  limit?: number;
  offset?: number;
};

type SafeMetadataValue =
  | string
  | number
  | boolean
  | null
  | SafeMetadataValue[]
  | { [key: string]: SafeMetadataValue };

const COMMERCE_ACTION_WHERE = [
  "(",
  "a.action LIKE 'BILLING_%'",
  "OR a.action LIKE 'ORG_ENTITLEMENT_%'",
  "OR a.action LIKE 'ENTITLEMENT_%'",
  "OR a.action LIKE 'PROVISIONING_%'",
  "OR a.action LIKE 'REVENUE_PROVISION_%'",
  "OR a.action LIKE 'USAGE_%'",
  "OR a.action IN ('ORG_CREATED_FROM_REVENUE_HANDOFF','PRODUCT_ACCESS_REQUESTED')",
  ")",
  "AND a.action NOT IN ('PROVISIONING_WORKER_HEARTBEAT','ENTITLEMENT_EXPIRY_WORKER_HEARTBEAT')",
].join(" ");

const SAFE_METADATA_KEYS = new Set([
  "operationId",
  "reason",
  "action",
  "product",
  "status",
  "previousStatus",
  "newStatus",
  "currentStatus",
  "targetStatus",
  "requestedStatus",
  "beforeStatus",
  "afterStatus",
  "provider",
  "mode",
  "result",
  "source",
  "plan",
  "tenantId",
  "serviceInstanceId",
  "externalCustomerId",
  "externalSubscriptionId",
  "externalPriceId",
  "statusOnActive",
  "eventId",
  "eventType",
  "jobId",
  "sourceDigest",
  "sourceVersion",
  "cancelAtPeriodEnd",
  "processorSubscriptions",
  "processorInvoices",
  "processorPaymentMethods",
  "attempts",
  "maxAttempts",
  "metric",
  "meterName",
  "limitValue",
  "lookupKey",
]);

const SAFE_CONTAINER_KEYS = new Set(["counts", "retired"]);

const SENSITIVE_KEY =
  /(password|secret|token|credential|private|authorization|cookie|api.?key|raw|payload)/i;

function safePrimitive(value: unknown): SafeMetadataValue | undefined {
  if (value === null) return null;
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 1000);
  if (Array.isArray(value)) {
    const items = value
      .slice(0, 24)
      .map((item) => safePrimitive(item))
      .filter((item): item is SafeMetadataValue => item !== undefined);
    return items;
  }
  return undefined;
}

function safeContainer(value: unknown): SafeMetadataValue | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const result: Record<string, SafeMetadataValue> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(key)) continue;
    const safe = safePrimitive(item);
    if (safe !== undefined) result[key.slice(0, 80)] = safe;
  }
  return result;
}

export function sanitizeCommerceAuditMetadata(
  value: unknown,
): Record<string, SafeMetadataValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, SafeMetadataValue> = {};

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (SAFE_METADATA_KEYS.has(key)) {
      const safe = safePrimitive(item);
      if (safe !== undefined) result[key] = safe;
      continue;
    }
    if (SAFE_CONTAINER_KEYS.has(key)) {
      const safe = safeContainer(item);
      if (safe !== undefined) result[key] = safe;
    }
  }

  return result;
}

export function commerceAuditFamily(action: string): CommerceAuditFamily {
  if (action.startsWith("BILLING_")) return "billing";
  if (
    action.startsWith("ORG_ENTITLEMENT_") ||
    action.startsWith("ENTITLEMENT_") ||
    action === "PRODUCT_ACCESS_REQUESTED"
  ) {
    return "entitlement";
  }
  if (action.startsWith("PROVISIONING_")) return "provisioning";
  if (
    action.startsWith("REVENUE_PROVISION_") ||
    action === "ORG_CREATED_FROM_REVENUE_HANDOFF"
  ) {
    return "revenue";
  }
  return "usage";
}

function normalizedLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 50;
  return Math.min(100, Math.max(1, Math.floor(value ?? 50)));
}

function normalizedOffset(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1_000_000, Math.max(0, Math.floor(value ?? 0)));
}

export async function getCommerceAuditEvidence(input: CommerceAuditQuery = {}) {
  const db = getDb();
  const clauses = [COMMERCE_ACTION_WHERE];
  const values: unknown[] = [];

  const addValue = (value: unknown) => {
    values.push(value);
    return "$" + values.length;
  };

  if (input.family) {
    const familyClause: Record<CommerceAuditFamily, string> = {
      billing: "a.action LIKE 'BILLING_%'",
      entitlement:
        "(a.action LIKE 'ORG_ENTITLEMENT_%' OR a.action LIKE 'ENTITLEMENT_%' OR a.action='PRODUCT_ACCESS_REQUESTED')",
      provisioning: "a.action LIKE 'PROVISIONING_%'",
      revenue:
        "(a.action LIKE 'REVENUE_PROVISION_%' OR a.action='ORG_CREATED_FROM_REVENUE_HANDOFF')",
      usage: "a.action LIKE 'USAGE_%'",
    };
    clauses.push(familyClause[input.family]);
  }

  if (input.action?.trim()) {
    clauses.push("a.action=" + addValue(input.action.trim()));
  }
  if (input.orgId?.trim()) {
    clauses.push('a."orgId"=' + addValue(input.orgId.trim()));
  }
  if (input.actorId?.trim()) {
    clauses.push('a."userId"=' + addValue(input.actorId.trim()));
  }
  if (input.q?.trim()) {
    const ref = addValue("%" + input.q.trim().slice(0, 160) + "%");
    clauses.push(
      "(a.action ILIKE " +
        ref +
        ' OR a."entityType" ILIKE ' +
        ref +
        ' OR a."entityId" ILIKE ' +
        ref +
        " OR COALESCE(o.name,'') ILIKE " +
        ref +
        " OR COALESCE(o.slug,'') ILIKE " +
        ref +
        ")",
    );
  }

  const where = clauses.join(" AND ");
  const limit = normalizedLimit(input.limit);
  const offset = normalizedOffset(input.offset);

  const statsValues = [...values];
  const stats = await db.query<{
    total: number;
    newestAt: string | null;
    oldestAt: string | null;
  }>(
    [
      "SELECT count(*)::int AS total,",
      'max(a."createdAt") AS "newestAt",min(a."createdAt") AS "oldestAt"',
      'FROM "AuditLog" a',
      'LEFT JOIN "Organization" o ON o.id=a."orgId"',
      "WHERE " + where,
    ].join(" "),
    statsValues,
  );

  const familyRows = await db.query<{ action: string; count: number }>(
    [
      "SELECT a.action,count(*)::int AS count",
      'FROM "AuditLog" a',
      'LEFT JOIN "Organization" o ON o.id=a."orgId"',
      "WHERE " + where,
      "GROUP BY a.action",
      "ORDER BY count(*) DESC,a.action",
    ].join(" "),
    [...values],
  );

  const rowValues = [...values];
  rowValues.push(limit, offset);
  const limitRef = "$" + (rowValues.length - 1);
  const offsetRef = "$" + rowValues.length;

  const rows = await db.query<{
    id: string;
    actorId: string | null;
    orgId: string | null;
    orgName: string | null;
    orgSlug: string | null;
    action: string;
    entityType: string;
    entityId: string;
    metadata: unknown;
    createdAt: string;
  }>(
    [
      'SELECT a.id,a."userId" AS "actorId",a."orgId",',
      'o.name AS "orgName",o.slug AS "orgSlug",',
      'a.action,a."entityType",a."entityId",a.metadata,a."createdAt"',
      'FROM "AuditLog" a',
      'LEFT JOIN "Organization" o ON o.id=a."orgId"',
      "WHERE " + where,
      'ORDER BY a."createdAt" DESC,a.id DESC',
      "LIMIT " + limitRef + " OFFSET " + offsetRef,
    ].join(" "),
    rowValues,
  );

  const familyCounts: Record<CommerceAuditFamily, number> = {
    billing: 0,
    entitlement: 0,
    provisioning: 0,
    revenue: 0,
    usage: 0,
  };

  for (const row of familyRows.rows) {
    familyCounts[commerceAuditFamily(row.action)] += Number(row.count ?? 0);
  }

  const statsRow = stats.rows[0] ?? {
    total: 0,
    newestAt: null,
    oldestAt: null,
  };

  return {
    total: Number(statsRow.total ?? 0),
    limit,
    offset,
    evidenceWindow: {
      newestAt: statsRow.newestAt ?? null,
      oldestAt: statsRow.oldestAt ?? null,
    },
    familyCounts,
    entries: rows.rows.map((row) => ({
      id: row.id,
      actorId: row.actorId,
      orgId: row.orgId,
      orgName: row.orgName,
      orgSlug: row.orgSlug,
      action: row.action,
      family: commerceAuditFamily(row.action),
      entityType: row.entityType,
      entityId: row.entityId,
      metadata: sanitizeCommerceAuditMetadata(row.metadata),
      createdAt: row.createdAt,
    })),
  };
}
