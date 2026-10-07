import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  INCIDENT_STATUSES,
  RETENTION_ACTIONS,
  RETENTION_ENTITY_TYPES,
} from "./compliance-governance.js";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/api") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

const service = repoFile("apps/api/src/lib/compliance-governance.ts");
const routes = repoFile("apps/api/src/routes/v1/modules/compliance.ts");
const registry = repoFile("apps/api/src/routes/v1/index.ts");

test("retention supports only explicit executable entities and excludes fake archive support", () => {
  assert.deepEqual([...RETENTION_ACTIONS], ["DELETE", "ANONYMIZE"]);
  assert.ok(!RETENTION_ACTIONS.includes("ARCHIVE" as never));
  assert.deepEqual([...RETENTION_ENTITY_TYPES], [
    "AuditLog",
    "SecurityEvent",
    "UsageEvent",
    "PlatformEvent",
    "Notification",
  ]);
  assert.doesNotMatch(service, /DataExport:\s*\{/);
  assert.doesNotMatch(service, /WebhookDelivery:\s*\{/);
});

test("organization retention is tenant scoped at the destructive SQL boundary", () => {
  assert.match(service, /scope === "ORGANIZATION" \? " AND " \+ org \+ "=\$2" : ""/);
  assert.match(service, /scope === "ORGANIZATION" \? \[orgId\] : \[\]/);
  assert.match(service, /assertOrganization\(client, input\.orgId\)/);
});

test("AuditLog deletion fails closed without immutable policy and approval-required rules block execution", () => {
  assert.match(
    service,
    /AuditLog deletion is blocked until an active immutable audit-retention rule exists/,
  );
  assert.match(service, /blockingApproval = rules\.find\(\(rule\) => rule\.requireApproval\)/);
  assert.match(service, /requires approval/);
  assert.match(service, /Retention period/);
  assert.match(service, /below immutable minimum/);
});

test("retention execution is batch bounded, confirmed, dry-runnable and audited", () => {
  assert.match(service, /const RETENTION_BATCH_LIMIT = 10_000/);
  assert.match(service, /LIMIT \$\{limitParam\}/);
  assert.match(service, /Retention confirmation does not match policy entity type/);
  assert.match(routes, /\/compliance\/retention\/policies\/:id\/preview/);
  assert.match(routes, /confirmEntityType: z\.enum\(RETENTION_ENTITY_TYPES\)/);
  assert.match(routes, /reason: z\.string\(\)\.trim\(\)\.min\(10\)/);
  assert.match(service, /RETENTION_POLICY_EXECUTED/);
});

test("compliance authority separates evidence, case management and destructive retention", () => {
  assert.match(routes, /"platform\.compliance\.read"/);
  assert.match(routes, /"platform\.compliance\.manage"/);
  assert.match(routes, /"platform\.compliance\.retention\.manage"/);
  assert.match(registry, /registerComplianceRoutes/);
});

test("incident lifecycle is constrained and preserves an append-only operator timeline", () => {
  assert.deepEqual([...INCIDENT_STATUSES], [
    "OPEN",
    "INVESTIGATING",
    "MITIGATED",
    "RESOLVED",
    "POST_MORTEM",
    "CLOSED",
  ]);
  assert.match(service, /Invalid incident transition/);
  assert.match(service, /event: "STATUS_CHANGED"/);
  assert.match(service, /timeline\.slice\(-200\)/);
  assert.match(service, /INCIDENT_STATUS_/);
});

test("governance incident operations use named organization context and explicit self-assignment", () => {
  assert.match(service, /SELECT id,name,slug,"isPlatformInternal"/);
  assert.match(service, /incidentTransitions: INCIDENT_TRANSITIONS/);
  assert.match(routes, /assignToSelf: z\.boolean\(\)\.default\(true\)/);
  assert.match(routes, /assignment: z\.enum\(\["KEEP", "SELF", "UNASSIGN"\]\)/);
  assert.match(routes, /body\.assignToSelf \? authority\.platformUserId : null/);
  assert.match(routes, /body\.assignment === "SELF"/);
  assert.match(routes, /body\.assignment === "UNASSIGN"/);
});

test("runbook content changes increment version and review dates are explicit", () => {
  assert.match(service, /version=CASE WHEN \$3::text IS NULL OR \$3=content THEN version ELSE version\+1 END/);
  assert.match(service, /COMPLIANCE_RUNBOOK_REVIEWED/);
  assert.match(routes, /nextReviewDays: z\.number\(\)\.int\(\)\.min\(7\)\.max\(365\)/);
});
