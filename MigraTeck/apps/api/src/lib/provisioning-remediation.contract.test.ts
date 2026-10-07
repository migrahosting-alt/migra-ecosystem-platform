import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function repoFile(path: string): string {
  const cwd = process.cwd();
  const root = cwd.endsWith("/apps/api") ? join(cwd, "../..") : cwd;
  return readFileSync(join(root, path), "utf8");
}

const service = repoFile("apps/api/src/lib/provisioning-remediation.ts");
const routes = repoFile("apps/api/src/routes/v1/modules/commerce-catalog.ts");
const operatorUi = repoFile(
  "apps/web/src/app/(platform)/platform/commerce/catalog/CatalogEntitlementsWorkspace.tsx",
);

test("dead-letter retry verifies immutable source evidence before replay", () => {
  assert.match(service, /hashCanonicalPayload\(job\.payload\) === job\.payloadHash/);
  assert.match(service, /verifyProvisioningEnvelope/);
  assert.match(service, /malformed/);
  assert.match(service, /Only DEAD provisioning jobs/);
  assert.match(service, /FOR UPDATE OF j/);
});

test("recovery accepts only audited context fields and never mailbox credentials", () => {
  assert.match(service, /domain/);
  assert.match(service, /tenantId/);
  assert.match(service, /serviceInstanceId/);
  assert.match(service, /targetIp/);
  assert.match(service, /mailboxEmail/);
  assert.match(service, /delete payload\.mailboxPassword/);
  assert.match(service, /delete payload\.mailboxSecretRef/);

  const start = routes.indexOf("const deadLetterRecoveryContextSchema");
  const end = routes.indexOf("const deadLetterRetrySchema");
  assert.ok(start >= 0 && end > start);
  const recoverySchema = routes.slice(start, end);
  assert.doesNotMatch(recoverySchema, /mailboxPassword|mailboxSecretRef/);
  assert.doesNotMatch(routes, /payload:\s*z\.(record|unknown|any)/);
});

test("retry is a new signed MANUAL job and the original dead job is canceled", () => {
  assert.match(service, /signProvisioningEnvelope/);
  assert.match(service, /dead-letter-retry:/);
  assert.match(service, /'MANUAL'::"ProvisioningJobSource"/);
  assert.match(service, /'PENDING'::"ProvisioningJobStatus"/);
  assert.match(service, /queued_from_dead_letter/);
  assert.match(service, /dead_letter_retry_queued/);
  assert.match(service, /CANCELED.*ProvisioningJobStatus/);
  assert.doesNotMatch(
    service,
    /UPDATE "ProvisioningJob" SET status=\'PENDING\'[^\n]*WHERE id=\$1[^\n]*DEAD/,
  );
});

test("dead-letter cancel preserves failure history and records operator evidence", () => {
  assert.match(service, /dead_letter_canceled/);
  assert.match(service, /previousError: job\.lastError/);
  assert.match(service, /PROVISIONING_DEAD_LETTER_CANCELED/);
  assert.match(service, /INSERT INTO "AuditLog"/);
});

test("only audited recovery actions are replayable", () => {
  assert.match(service, /MIGRAHOSTING/);
  assert.match(service, /POD_CREATE/);
  assert.match(service, /DNS_PROVISION/);
  assert.match(service, /MIGRAMAIL/);
  assert.match(service, /MAIL_DISABLE/);
  assert.match(service, /no audited replay contract/i);
});

test("recovery routes require platform commerce authority", () => {
  assert.match(
    routes,
    /commerce\/provisioning\/jobs\/:jobId\/remediation[\s\S]*?platform\.commerce\.read/,
  );
  assert.match(
    routes,
    /commerce\/provisioning\/jobs\/:jobId\/retry[\s\S]*?platform\.commerce\.entitlements\.manage/,
  );
  assert.match(
    routes,
    /commerce\/provisioning\/jobs\/:jobId\/cancel[\s\S]*?platform\.commerce\.entitlements\.manage/,
  );
});

test("cross-system recovery suggestions require Hosting read authority and remain optional", () => {
  assert.match(service, /getHostingRecoveryCandidates/);
  assert.match(service, /includeHostingSuggestions/);
  assert.match(service, /hostingCandidates/);
  assert.match(service, /suggestionReason/);
  assert.match(routes, /authority\.permissions\.includes\(\s*"platform\.hosting\.read"/);
  assert.match(
    routes,
    /getDeadLetterRemediation\(jobId, \{[\s\S]*?includeHostingSuggestions/,
  );
});

test("switching Hosting recovery candidates cannot retain another tenant's ambiguous context", () => {
  assert.match(operatorUi, /key=\{deadLetter\.job\.id\}/);
  assert.match(operatorUi, /current\.tenantId === candidate\.tenantId/);
  assert.match(operatorUi, /tenantId: candidate\.tenantId/);
  assert.match(
    operatorUi,
    /candidate\.suggestedContext\.domain \?\?[\s\S]*?sameTenant \? current\.domain : ""/,
  );
  assert.match(
    operatorUi,
    /candidate\.suggestedContext\.serviceInstanceId \?\?[\s\S]*?sameTenant \? current\.serviceInstanceId : ""/,
  );
  assert.match(
    operatorUi,
    /candidate\.suggestedContext\.targetIp \?\?[\s\S]*?sameTenant \? current\.targetIp : ""/,
  );
  assert.match(
    operatorUi,
    /chooseRecoveryValue\(\s*candidate,\s*"serviceInstanceId"/,
  );
});

test("operators can explicitly search Hosting authority without automatic linking", () => {
  assert.match(operatorUi, /\/api\/platform\/hosting\/tenants\?/);
  assert.match(
    operatorUi,
    /\/api\/platform\/hosting\/tenants\/"\s*\+[\s\S]*?\/recovery-context/,
  );
  assert.match(operatorUi, /Selecting a tenant only loads read-only recovery evidence/);
  assert.match(operatorUi, /setManualHostingCandidate\(candidate\)/);
  assert.doesNotMatch(operatorUi, /\/api\/platform\/hosting\/binding/);
});
