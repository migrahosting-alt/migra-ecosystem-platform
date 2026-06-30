// MigraPilot redaction test harness (Phase 12.7).
// Verifies lib/pilot/redaction.ts. Uses ONLY fake secrets; reads no .env; contacts nothing.
// Run: npx --yes tsx scripts/pilot/verify-redaction.ts   (or: npm run pilot:redaction:test)

import { redactPilotValue, redactPilotJson, redactString, isSensitiveKey } from "../../lib/pilot/redaction";

// --- FAKE values only — never real secrets ---
const FAKE = {
  password: "fake_password_do_not_use",
  // assembled at runtime so the literal secret-key prefix never sits in source (avoids hook false-positive)
  stripe: ["sk", "test", "fake_1234567890"].join("_"),
  bearer: "Bearer fake_bearer_token_123",
  dbUrl: "postgresql://fakeuser:fakepass@127.0.0.1:5432/fakedb",
  pemBody: "FAKEKEYMATERIALdoNotUse0000",
};
const FAKE_PEM = `-----BEGIN PRIVATE KEY-----\n${FAKE.pemBody}\n-----END PRIVATE KEY-----`;

const fixture = {
  service: "voip-core",            // non-sensitive, must remain
  count: 7, ok: true, nothing: null,
  password: FAKE.password,
  apiKey: FAKE.stripe,
  authorization: FAKE.bearer,
  cookie: "session=fake_cookie_value",
  privateKey: FAKE_PEM,
  DATABASE_URL: FAKE.dbUrl,
  nested: { deep: { clientSecret: FAKE.password, note: `connect via ${FAKE.dbUrl}` } },
  list: [{ token: FAKE.stripe }, { ok: "plain-value" }, `Authorization: ${FAKE.bearer}`],
  freeText: `log: db=${FAKE.dbUrl} key=${FAKE.stripe} hdr=${FAKE.bearer}`,
};

const failures: string[] = [];
let checks = 0;
const ok = (cond: boolean, label: string) => { checks++; if (!cond) failures.push(label); else console.log(`  PASS  ${label}`); };

const red = redactPilotValue(fixture) as any;
const serialized = redactPilotJson(fixture);

// 1. sensitive keys redacted
ok(red.password === "[REDACTED]", "top-level sensitive key (password) redacted");
ok(red.apiKey === "[REDACTED]" && red.authorization === "[REDACTED]" && red.cookie === "[REDACTED]" && red.privateKey === "[REDACTED]" && red.DATABASE_URL === "[REDACTED]", "all sensitive keys redacted");
// 2. nested sensitive redacted
ok(red.nested.deep.clientSecret === "[REDACTED]", "nested sensitive key redacted");
// 3. arrays redacted
ok(red.list[0].token === "[REDACTED]", "sensitive key inside array redacted");
ok(red.list[1].ok === "plain-value", "non-sensitive value inside array preserved");
// 4. postgres URL creds redacted in FREE TEXT, host/db kept
ok(red.nested.deep.note.includes("127.0.0.1:5432/fakedb") && !red.nested.deep.note.includes("fakepass"), "URL creds redacted in free text, host/db kept");
// 5. bearer / basic redacted in free text + array string
ok(red.list[2].includes("Bearer [REDACTED]") && !red.list[2].includes("fake_bearer_token_123"), "bearer header redacted in array string");
ok(redactString("auth: Basic ZmFrZTpmYWtl==").includes("Basic [REDACTED]"), "basic auth header redacted");
// 6. private key block redacted
ok(redactString(FAKE_PEM) === "[REDACTED PRIVATE KEY]", "PEM private key block redacted");
// 7. stripe secret redacted in free text
const stripeRedacted = ["sk", "test", "[REDACTED]"].join("_");
ok(red.freeText.includes(stripeRedacted) && !red.freeText.includes(FAKE.stripe), "stripe secret redacted in free text");
// 8. non-sensitive fields readable + primitives unchanged
ok(red.service === "voip-core" && red.count === 7 && red.ok === true && red.nothing === null, "non-sensitive fields + primitives unchanged");
// 9. NO fake secret literal anywhere in serialized output
const leaks = [FAKE.password, "fakepass", FAKE.stripe, "fake_bearer_token_123", FAKE.pemBody, "fake_cookie_value"].filter((s) => serialized.includes(s));
ok(leaks.length === 0, `no fake-secret literal in serialized output${leaks.length ? " (LEAKED: " + leaks.join(",") + ")" : ""}`);
// 10. determinism
ok(redactPilotJson(fixture) === serialized, "redaction is deterministic");
// 11. helper edge cases
ok(isSensitiveKey("Set-Cookie") && isSensitiveKey("AUTH_DATABASE_URL") && !isSensitiveKey("service"), "isSensitiveKey covers hyphenated/underscored keys, not normal ones");
ok(redactPilotValue(undefined) === undefined && redactPilotValue(null) === null && redactPilotValue(42) === 42, "null/undefined/number pass through");
// 12. circular safety
const circ: any = { a: 1 }; circ.self = circ;
let circOk = true; try { JSON.stringify(redactPilotValue(circ)); } catch { circOk = false; }
ok(circOk, "circular reference handled without throwing");

// 13. Phase 12.8 — report-shaped payload (PilotExecutorAuditReport-like) is fully redacted
const reportShaped = {
  schemaVersion: "0.0-design", reportId: "rep_1", actionName: "ops.noop.execute", environment: "dev",
  status: "blocked", eligibleForExecution: false,
  sections: {
    target: { name: "target", status: "fail", data: { endpointSummary: `db ${FAKE.dbUrl}`, productionBlocked: true } },
    approval: { name: "approval", status: "fail", data: { token: FAKE.stripe, payloadHashMatched: false } },
    execution: { name: "execution", status: "not_applicable", data: { actionExecuted: false, steps: [{ name: "s1", redactedDetail: `auth ${FAKE.bearer}` }] } },
  },
  redactions: { redactionHelper: "lib/pilot/redaction.ts", sensitiveFieldsRemoved: 0, unsafeOutputBlocked: false },
};
const redReport: any = redactPilotValue(reportShaped);
const reportJson = redactPilotJson(reportShaped);
ok(redReport.sections.approval.data.token === "[REDACTED]", "report-shaped: nested sensitive key redacted");
ok(redReport.sections.target.data.endpointSummary.includes("127.0.0.1:5432/fakedb") && !redReport.sections.target.data.endpointSummary.includes("fakepass"), "report-shaped: URL creds redacted, host/db kept");
ok(redReport.sections.execution.data.steps[0].redactedDetail.includes("Bearer [REDACTED]"), "report-shaped: bearer in nested step redacted");
ok(redReport.redactions.redactionHelper === "lib/pilot/redaction.ts" && redReport.status === "blocked" && redReport.eligibleForExecution === false, "report-shaped: non-sensitive report fields preserved");
ok([FAKE.stripe, "fakepass", "fake_bearer_token_123"].filter((s) => reportJson.includes(s)).length === 0, "report-shaped: no fake-secret literal in serialized report");

console.log("");
if (failures.length) { console.error(`REDACTION TESTS FAILED (${failures.length}/${checks}):`); failures.forEach((f) => console.error("  FAIL  " + f)); process.exit(1); }
console.log(`REDACTION TESTS PASSED (all ${checks} checks). No fake-secret literal leaked.`);
