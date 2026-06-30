# MigraPilot Executor Audit Report — Schema Design (Phase 12.8)

> **Status: DESIGN ONLY — NOT IMPLEMENTED.** This document defines the *future* audit-report contract
> that a dev-only executor would emit. **No executor, no report runtime, no tool, no route is created.**
> Behavior is unchanged: `ops-eligibility-policy.ts` returns `eligibleForExecution:false` for every
> input; all real verbs are `enabled:false` / **blocked** by `policy.ts`; the target allowlist returns
> `eligible:false`. The only existing, usable building block is the tested redaction helper
> [`lib/pilot/redaction.ts`](../../lib/pilot/redaction.ts) (Phase 12.7).
>
> **Hard rule (Phase 12.8):** there is **no executable path for real actions** after this phase.

Companion designs: [`ops-executor-design-phase-12-5.md`](./ops-executor-design-phase-12-5.md) ·
[`ops-executor-lock-design-phase-12-6.md`](./ops-executor-lock-design-phase-12-6.md).

## 1. Purpose

Every future action (including **blocked** and **failed** attempts) must produce a structured,
copy-safe audit report that:

- makes the action **reviewable** (what was requested, gated, executed, verified, and the outcome);
- provides **copy-safe evidence** (no secrets — everything passes `redactPilotValue`);
- preserves **operator accountability** (requestedBy / approvedBy);
- **connects** request → approval → lock → execution → verification → outcome (by id);
- supports **incident review** and **rollback/recovery** decisions;
- **never exposes secrets**.

The report is **derived from journal events** (the Postgres ops journal is the source of truth); it is
evidence, not the system of record.

## 2. Required top-level fields

`reportId` · `actionId` · `actionName` · `targetId` · `serviceName?` · `resourceId?` · `environment` ·
`requestedBy` · `approvedBy` · `approvalId` · `approvalPayloadHash` · `lockId` · `journalActionId` ·
`idempotencyKey` · `status` · `riskLevel` · `startedAt` · `finishedAt` · `durationMs` · `generatedAt` ·
`schemaVersion`.

## 3. Status values

`blocked` · `planned` · `approved` · `preflight_failed` · `lock_failed` · `running` ·
`postcheck_failed` · `health_failed` · `completed` · `completed_with_warnings` · `failed` ·
`rollback_recommended` · `rollback_completed` · `cancelled`.

## 4. Required sections

`summary` · `target` · `approval` · `eligibility` · `preflight` · `lock` · `execution` · `postchecks` ·
`health` · `journal` · `artifacts` · `redactions` · `hazards` · `rollback` · `operatorNotes` ·
`limitations`. Every section is present even when empty (explicit `notApplicable`/empty arrays), so a
missing section can never be mistaken for "nothing happened."

### Section shapes (illustrative)

- **summary:** `{ outcome, humanReadableSummary, customerImpact, productionImpact, actionExecuted:boolean, eligibleForExecution:boolean (false this era), eligibleForFuturePromotion:boolean }`
- **target:** `{ targetId, environment, serviceName?, endpointSummary (sanitized, no creds), productionBlocked:boolean, targetFingerprint, targetDriftDetected:boolean }`
- **approval:** `{ approvalId, approvalRequired:boolean, approvalVerified:boolean, approvalFresh:boolean, approvalSingleUse:boolean, payloadHashMatched:boolean }`
- **eligibility:** `{ eligibleForExecution:false, eligibleForFuturePromotion:boolean, gates:[{name,status,required,evidence}], blockers[], warnings[] }`
- **preflight:** `{ status, checks:[{name,status,evidence,required}], hazards[], missingRequirements[] }`
- **lock:** `{ lockId, acquired:boolean, status, acquiredAt?, releasedAt?, releaseReason?, heartbeatSummary }`
- **execution:** `{ actionExecuted:boolean, dryRun:boolean, steps:[{name,status,redactedDetail}], exitSummary }`
- **postchecks:** `{ status, checks:[{name,status,evidence}] }`
- **health:** `{ status, checks:[{name,status,sanitizedUrl,evidence}], bodiesReturned:false }`
- **journal:** `{ journalActionId, events:[{event,at,refId}], backend:"postgres"|"memory" }`
- **artifacts:** `PilotAuditArtifactRef[]` (see §5)
- **redactions:** `{ redactionPolicyVersion, redactionHelper:"lib/pilot/redaction.ts", sensitiveFieldsRemoved:number, urlCredentialsRedacted:number, secretPatternsDetected:number, unsafeOutputBlocked:boolean }`
- **hazards:** `string[]` (grounded, sanitized)
- **rollback:** `{ rollbackRecommended:boolean, autoRollback:false, recoveryGuidance:string[], runbookRef? }`
- **operatorNotes:** `string[]` (redacted free text)
- **limitations:** `string[]`

## 5. Artifact handling

- **No raw logs by default.** Excerpts must be **redacted** (via `redactPilotValue`).
- Command output is **summarized**, not dumped.
- Artifacts referenced by **ID/path**, not embedded when sensitive.
- Reports remain **copy-safe**; **binary artifacts excluded** unless explicitly marked safe.
- **No secrets in filenames** (filenames themselves are scanned).
- `PilotAuditArtifactRef = { id, kind, path?, byteSize?, sha256?, redacted:boolean, safeToEmbed:boolean, summary }`.

## 6. Redaction requirements

- **All report payloads pass through `redactPilotValue`** before save/display/export.
- Output is **scanned for sensitive literals** before save/display; on any hit → **fail closed** (block).
- URL credentials redacted; `Authorization`/`Cookie`/`Set-Cookie` redacted; private keys redacted;
  database URLs redacted; token-like values redacted under sensitive keys.
- The report records **redaction counts, never secret values** (`PilotAuditRedactionSummary`).
- **If redaction fails, report generation fails closed** (no partial/unredacted report is produced).

## 7. Future TypeScript interfaces (documentation only — NOT wired)

```ts
// ILLUSTRATIVE — not compiled, not imported.
type PilotAuditReportSection = {
  name: string;
  status: "pass" | "fail" | "partial" | "unknown" | "not_applicable";
  evidence?: string;          // redacted
  data?: Record<string, unknown>; // redacted via redactPilotValue
};

type PilotAuditArtifactRef = {
  id: string; kind: string; path?: string; byteSize?: number; sha256?: string;
  redacted: boolean; safeToEmbed: boolean; summary: string;
};

type PilotAuditRedactionSummary = {
  redactionPolicyVersion: string;
  redactionHelper: "lib/pilot/redaction.ts";
  sensitiveFieldsRemoved: number;
  urlCredentialsRedacted: number;
  secretPatternsDetected: number;
  unsafeOutputBlocked: boolean;
};

type PilotExecutorAuditReport = {
  schemaVersion: string;
  reportId: string; actionId: string; actionName: string; targetId: string;
  serviceName?: string; resourceId?: string; environment: "dev";
  requestedBy: string; approvedBy?: string; approvalId?: string; approvalPayloadHash?: string;
  lockId?: string; journalActionId?: string; idempotencyKey?: string;
  status: string; riskLevel: "low" | "medium" | "high";
  startedAt?: string; finishedAt?: string; durationMs?: number; generatedAt: string;
  eligibleForExecution: false; // remains false until a real executor is promoted
  sections: Record<string, PilotAuditReportSection>;
  artifacts: PilotAuditArtifactRef[];
  redactions: PilotAuditRedactionSummary;
};
```

## 8. Storage rules

- **Postgres journal remains the source of event truth.** The report **may be generated from journal events**.
- Report storage is **immutable / append-only** where practical; **updates create new versions**, never destructive edits.
- **Reports for failed/blocked attempts are still stored** (a blocked attempt is itself evidence).
- **Retention policy must be explicit** before any runtime implementation.

## 9. UI requirements

- Show **copy-safe summary** + **risk/status badges**.
- Show the **redaction summary** (counts).
- Link **approval / lock / journal** by id.
- Show **blocked production attempts** clearly.
- Show **rollback recommendation separately from auto-rollback** (auto-rollback is `false`).
- **Never show secrets**; **"copy report"** emits the **redacted** version only.

## 10. Failure behavior

- Report-generation failure → journal `executor.report_failed` (future).
- Redaction failure → **block report display/export**.
- Audit-storage failure → action considered **incomplete/degraded**.
- Report not generable → **operator warned**; **no silent success without a report**.

## 11. Future journal events

`executor.report.requested` · `executor.report.generated` · `executor.report.redacted` ·
`executor.report.exported` · `executor.report.failed` · `executor.report.storage_failed`.

## 12. Promotion gates — all required before implementation

Bonex approval · schema reviewed · **redaction helper wired into the report generator** ·
report generator **tested with fake secrets** · export/copy path tested · journal-to-report mapping
tested · UI reviewed · CI/typecheck/build green · **no production target configured** · **no real
executor enabled**.

## 13. What this phase does NOT do
- No executor, report generator, route, tool, migration, or interface in source.
- No registry/policy/classification change; `eligibleForExecution` stays hard-`false`.
- No wiring of `redactPilotValue` into existing report/journal call sites (that is Phase 12.9).
- Adds this document, two cross-reference lines in the 12.5/12.6 docs, and one extra
  report-shaped fixture case in the existing redaction harness (no refactor, no runtime change).

## 14. Next safe step
- **12.9 — Wire the redaction helper into existing safe-read reports** (report/journal output passes
  through `redactPilotValue`), still with **no executor and no real actions**.
