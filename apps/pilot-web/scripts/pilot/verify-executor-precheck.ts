// MigraPilot Executor Pre-Implementation Checklist — consistency verifier (Phase 12.15).
// READ-ONLY. Confirms the checklist stays in sync with the safety-invariant manifest + package
// scripts, and that the executor is still declared not-ready. It does NOT re-run the safety gate
// (that is `npm run pilot:verify`) — it guards against DRIFT, not against unsafe posture.
// Run: npx --yes tsx scripts/pilot/verify-executor-precheck.ts (or: npm run pilot:precheck:verify)

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EXECUTOR_PRECHECKS, EXECUTOR_PRECHECK_VERSION, MANIFEST_VERSION_REF, EXECUTOR_READY, pendingPromotionPrechecks } from "../../lib/pilot/executor-precheck";
import { SAFETY_INVARIANTS, SAFETY_INVARIANTS_VERSION } from "../../lib/pilot/safety-invariants";

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

console.log("");
console.log(`Executor pre-implementation checklist v${EXECUTOR_PRECHECK_VERSION} — EXECUTOR_READY=${EXECUTOR_READY}; ${pendingPromotionPrechecks().length} promotion prechecks pending`);
if (failures.length) { console.error(`PRECHECK CONSISTENCY FAILED (${failures.length}):`); failures.forEach((f) => console.error("  FAIL  " + f)); process.exit(1); }
console.log("PRECHECK CONSISTENCY OK — checklist is in sync with the manifest + commands, executor remains not-ready.");
