// MigraPilot Executor Pre-Implementation Checklist — consistency verifier (Phase 12.15).
// READ-ONLY. Confirms the checklist stays in sync with the safety-invariant manifest + package
// scripts, and that the executor is still declared not-ready. It does NOT re-run the safety gate
// (that is `npm run pilot:verify`) — it guards against DRIFT, not against unsafe posture.
// Run: npx --yes tsx scripts/pilot/verify-executor-precheck.ts (or: npm run pilot:precheck:verify)

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EXECUTOR_PRECHECKS, EXECUTOR_PRECHECK_VERSION, MANIFEST_VERSION_REF, EXECUTOR_READY, pendingPromotionPrechecks } from "../../lib/pilot/executor-precheck";
import { SAFETY_INVARIANTS, SAFETY_INVARIANTS_VERSION } from "../../lib/pilot/safety-invariants";
import { buildPromotionStatus } from "../../lib/pilot/promotion-status";
import { buildReportExportPreview } from "../../lib/pilot/report-export";
import { buildPromotionEvidenceBundle } from "../../lib/pilot/promotion-evidence";

const ROOT = process.cwd();
const failures: string[] = [];
const ok = (cond: boolean, label: string) => { if (!cond) failures.push(label); else console.log(`  PASS  ${label}`); };

// 1. executor still declared not-ready (machine-checkable "still cold" guard)
ok(EXECUTOR_READY === false, "EXECUTOR_READY is false (executor remains forbidden)");

// 2. manifest version drift guard — checklist must reference the current manifest version
ok(MANIFEST_VERSION_REF === SAFETY_INVARIANTS_VERSION, `checklist MANIFEST_VERSION_REF (${MANIFEST_VERSION_REF}) == SAFETY_INVARIANTS_VERSION (${SAFETY_INVARIANTS_VERSION})`);

// 3. every precheck is blocking; there is at least one standing + one promotion; all have status
ok(EXECUTOR_PRECHECKS.every((p) => p.blocking === true), "every precheck is blocking");
ok(EXECUTOR_PRECHECKS.some((p) => p.category === "standing") && EXECUTOR_PRECHECKS.some((p) => p.category === "promotion"), "checklist has both standing and promotion prechecks");
ok(EXECUTOR_PRECHECKS.every((p) => p.status === "satisfied" || p.status === "pending"), "every precheck has a valid status");

// 4. promotion prechecks remain PENDING (nothing silently pre-approved)
ok(pendingPromotionPrechecks().length > 0 && EXECUTOR_PRECHECKS.filter((p) => p.category === "promotion").every((p) => p.status === "pending"),
  `all promotion prechecks pending (${pendingPromotionPrechecks().length})`);
// human approval must be pending
ok(EXECUTOR_PRECHECKS.find((p) => p.id === "explicit-human-approval")?.status === "pending", "explicit-human-approval is pending");

// 5. each 'satisfiedBy' that names an invariant id resolves to a real manifest invariant
{
  const invIds = new Set(SAFETY_INVARIANTS.map((i) => i.id));
  const invRefs = EXECUTOR_PRECHECKS.map((p) => p.satisfiedBy).filter((s) => invIds.has(s));
  const bad = EXECUTOR_PRECHECKS.filter((p) => invIds.has(p.satisfiedBy.split(" ")[0]) === false && /^[a-z-]+$/.test(p.satisfiedBy) && !invIds.has(p.satisfiedBy));
  ok(invRefs.length >= 5 && bad.length === 0, `>=5 prechecks map to real manifest invariants (${invRefs.length}); dangling invariant refs: ${bad.length}`);
}

// 6. referenced npm commands exist in package.json (no dangling command references)
{
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as { scripts?: Record<string, string> };
  const scripts = new Set(Object.keys(pkg.scripts ?? {}));
  const referenced = ["pilot:redaction:test", "pilot:safety:verify", "pilot:verify", "pilot:ci"];
  const missing = referenced.filter((c) => !scripts.has(c));
  ok(missing.length === 0, `referenced pilot commands all present: [missing: ${missing.join(",")}]`);
}

// 7. promotion-status builder (12.16) accurately reflects the checklist (no drift / no duplication)
{
  const st = buildPromotionStatus(new Date(0).toISOString());
  ok(st.executorReady === EXECUTOR_READY, "promotion-status.executorReady mirrors EXECUTOR_READY");
  ok(st.totals.total === EXECUTOR_PRECHECKS.length, `promotion-status total (${st.totals.total}) == checklist length (${EXECUTOR_PRECHECKS.length})`);
  ok(st.pendingPromotionPrechecks === pendingPromotionPrechecks().length, `promotion-status pending (${st.pendingPromotionPrechecks}) == pendingPromotionPrechecks (${pendingPromotionPrechecks().length})`);
  ok(st.executorBlocked === true && st.blockingFailures.length === 0, "promotion-status reports executor blocked, no standing regression / manifest drift");

  // 8. promotion-status export preview (12.17) is copy-safe, preview-only, and reflects the same totals
  const ex = buildReportExportPreview({ report: st, format: "json", title: "promo" }, new Date(0).toISOString());
  ok(ex.copySafe === true && ex.executed === false && ex.written === false && ex.eligibleForExecution === false, "promotion export preview is copy-safe + preview-only (executed/written/eligibleForExecution false)");
  let parsed: any = {};
  try { parsed = JSON.parse(ex.content); } catch { /* leave empty → fails below */ }
  ok(parsed.executorReady === false && parsed.totals?.total === EXECUTOR_PRECHECKS.length && parsed.totals?.standing?.satisfied === st.totals.standing.satisfied && parsed.totals?.promotion?.pending === st.pendingPromotionPrechecks && (parsed.blockingFailures?.length ?? -1) === 0,
    `promotion export reflects checklist totals (total ${parsed.totals?.total}, standing satisfied ${parsed.totals?.standing?.satisfied}, promotion pending ${parsed.totals?.promotion?.pending}, blockingFailures ${parsed.blockingFailures?.length})`);

  // 9. promotion evidence bundle (12.18) reflects the same status totals and keeps executorReady false
  const bundle = buildPromotionEvidenceBundle(new Date(0).toISOString());
  ok(bundle.executorReady === false && bundle.eligibleForExecutionExpected === false, "evidence bundle: executorReady + eligibleForExecutionExpected false");
  ok(bundle.precheckTotals.total === EXECUTOR_PRECHECKS.length && bundle.pendingPromotionGates.length === st.pendingPromotionPrechecks && bundle.blockingFailures.length === 0,
    `evidence bundle reflects totals (total ${bundle.precheckTotals.total}, pending ${bundle.pendingPromotionGates.length}, blockingFailures ${bundle.blockingFailures.length})`);
  ok(bundle.safetyInvariantVersion === SAFETY_INVARIANTS_VERSION && bundle.manifestInSync === true && bundle.verificationCommands.length >= 5, "evidence bundle: manifest version in sync + verification commands present");
}

console.log("");
console.log(`Executor pre-implementation checklist v${EXECUTOR_PRECHECK_VERSION} — EXECUTOR_READY=${EXECUTOR_READY}; ${pendingPromotionPrechecks().length} promotion prechecks pending`);
if (failures.length) { console.error(`PRECHECK CONSISTENCY FAILED (${failures.length}):`); failures.forEach((f) => console.error("  FAIL  " + f)); process.exit(1); }
console.log("PRECHECK CONSISTENCY OK — checklist is in sync with the manifest + commands, executor remains not-ready.");
