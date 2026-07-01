// MigraPilot Ops-Safety Invariant verifier (Phase 12.12).
// READ-ONLY. Checks the SAFETY_INVARIANTS manifest against the live policy/registry/tool/route posture.
// No env, no network, no DB, no external services; reads only in-repo source + pure functions.
// Run: npx --yes tsx scripts/pilot/verify-safety-invariants.ts  (or: npm run pilot:safety:verify)

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { SAFETY_INVARIANTS, SAFETY_INVARIANTS_VERSION } from "../../lib/pilot/safety-invariants";
import { classifyPilotAction } from "../../lib/pilot/policy";
import { TOOLS } from "../../lib/pilot/tools";
import { listOpsActions } from "../../lib/pilot/ops-action-registry";
import { checkEligibility, previewEligibility } from "../../lib/pilot/ops-eligibility-policy";

const ROOT = process.cwd();
const risk = (n: string, a: Record<string, unknown> = {}) => classifyPilotAction(n, a).risk;
const routeSrc = (p: string) => { try { return readFileSync(resolve(ROOT, "app/api/pilot", p, "route.ts"), "utf8"); } catch { return ""; } };
const usesSafeJson = (p: string) => /safe-output|safeJson/.test(routeSrc(p));

async function main() {
  const results: { id: string; pass: boolean; detail: string }[] = [];
  const record = (id: string, pass: boolean, detail: string) => results.push({ id, pass, detail });

  // executor-absent
  {
    // A real executor MODULE trips this; design/checklist data files (executor-precheck, *-design) do not.
    const execLib = readdirSync(resolve(ROOT, "lib/pilot")).filter((f) => /executor/i.test(f) && !/precheck|checklist|manifest|design/i.test(f));
    const execTool = Object.keys(TOOLS).filter((t) => /executor|\.execute_real|real_exec/i.test(t));
    record("executor-absent", execLib.length === 0 && execTool.length === 0, `lib executor files: ${execLib.length}; executor tools: ${execTool.length}`);
  }
  // eligible-for-execution-hard-false
  {
    const cases = [["nope", "ops.noop.execute"], ["dev-sample-service", "ops.deploy"], ["dev-sample-service", "ops.noop.execute"]] as const;
    const checks = await Promise.all(cases.map(([t, a]) => checkEligibility({ targetId: t, actionName: a }, new Date(0).toISOString())));
    const prev = previewEligibility({ targetId: "x", actionName: "y" });
    const allFalse = checks.every((c) => c.eligibleForExecution === false) && prev.eligibleForExecution === false;
    record("eligible-for-execution-hard-false", allFalse, `checkEligibility×${checks.length} + preview all eligibleForExecution:false = ${allFalse}`);
  }
  // real-ops-actions-disabled
  {
    const reg = listOpsActions().actions;
    const disabled = reg.filter((a) => !a.enabled).map((a) => a.actionName);
    const enabled = reg.filter((a) => a.enabled).map((a) => a.actionName);
    const realBlocked = ["ops.deploy", "ops.deploy.execute", "ops.restart", "ops.service.restart", "ops.dns.update", "ops.db.migrate", "ops.ssh", "ops.shell", "ops.suspend", "ops.restore"].every((n) => risk(n) === "blocked");
    const disabledRegBlocked = disabled.every((n) => risk(n) === "blocked");
    record("real-ops-actions-disabled", realBlocked && disabledRegBlocked && disabled.length >= 5 && enabled.every((n) => /noop|status_marker|webhook_sim/.test(n)),
      `registry ${enabled.length} enabled (${enabled.join(",")}) / ${disabled.length} disabled; real verbs blocked=${realBlocked}`);
  }
  // safe-read-no-approval
  {
    const safeReads = ["image.health", "image.preview", "ops.report.generate", "ops.report.export_preview", "ops.eligibility.preview", "ops.eligibility.check", "ops.targets.list", "ops.targets.check", "ops.health_bundle.run", "ops.noop.verify"];
    const bad = safeReads.filter((n) => { const d = classifyPilotAction(n, { reportType: "x", target: "y", targetId: "x", actionName: "y" }); return d.risk !== "safe_read" || d.requiresApproval; });
    record("safe-read-no-approval", bad.length === 0, `safe_read tools requiring approval: [${bad.join(",")}]`);
  }
  // requires-approval-internal-only
  {
    const gated = ["ops.noop.execute", "ops.status_marker.set", "ops.status_marker.transition", "ops.webhook_sim.send"];
    const ok = gated.every((n) => classifyPilotAction(n, { target: "x", reason: "r", nextStatus: "in_progress", url: "https://x" }).risk === "requires_approval");
    record("requires-approval-internal-only", ok, `controlled gated tools all requires_approval = ${ok}`);
  }
  // approval-eligibility-paths-not-redaction-wrapped
  {
    const mustNot = ["ops/eligibility", "ops/targets", "ops/targets/check", "ops/preflight", "approvals"];
    const violators = mustNot.filter((p) => usesSafeJson(p));
    record("approval-eligibility-paths-not-redaction-wrapped", violators.length === 0, `routes wrongly redaction-wrapped: [${violators.join(",")}]`);
  }
  // safe-read-surfaces-redacted
  {
    const mustWrap = ["ops/report/generate", "ops/report/preview", "ops/report/export/preview", "ops/actions/journal", "ops/noop/recent", "ops/markers/recent", "ops/webhook/recent", "audit", "image/health"];
    const missing = mustWrap.filter((p) => !usesSafeJson(p));
    record("safe-read-surfaces-redacted", missing.length === 0, `redacted safe-read routes missing safeJson: [${missing.join(",")}]`);
  }
  // code-paths-not-redacted
  {
    const mustNot = ["repo/status", "sources", "sources/search", "image/preview"];
    const violators = mustNot.filter((p) => usesSafeJson(p));
    record("code-paths-not-redacted", violators.length === 0, `code/source routes wrongly redaction-wrapped: [${violators.join(",")}]`);
  }
  // image-generate-approval-gated
  record("image-generate-approval-gated", risk("image.generate", { prompt: "x" }) === "requires_approval", `image.generate = ${risk("image.generate", { prompt: "x" })}`);
  // image-diagnostics-safe-read
  record("image-diagnostics-safe-read", risk("image.health") === "safe_read" && risk("image.preview", { prompt: "x" }) === "safe_read", `image.health=${risk("image.health")} image.preview=${risk("image.preview", { prompt: "x" })}`);

  // --- report ---
  console.log(`MigraPilot safety-invariant manifest v${SAFETY_INVARIANTS_VERSION}`);
  const byId = new Map(results.map((r) => [r.id, r]));
  let failed = 0, checked = 0, documented = 0;
  for (const inv of SAFETY_INVARIANTS) {
    if (!inv.machineCheckable) { console.log(`  DOC   [${inv.severity}] ${inv.id} — documented (manual): ${inv.description}`); documented++; continue; }
    const r = byId.get(inv.id);
    if (!r) { console.error(`  MISS  [${inv.severity}] ${inv.id} — NO CHECK IMPLEMENTED`); failed++; continue; }
    checked++;
    if (r.pass) console.log(`  PASS  [${inv.severity}] ${inv.id} — ${r.detail}`);
    else { console.error(`  FAIL  [${inv.severity}] ${inv.id} — ${r.detail}`); failed++; }
  }
  const orphan = results.filter((r) => !SAFETY_INVARIANTS.some((i) => i.id === r.id));
  if (orphan.length) { console.error(`  ORPHAN checks not in manifest: ${orphan.map((o) => o.id).join(",")}`); failed++; }

  console.log("");
  if (failed) { console.error(`SAFETY INVARIANTS FAILED: ${failed} (checked ${checked}, documented ${documented})`); process.exit(1); }
  console.log(`SAFETY INVARIANTS OK — ${checked} machine-checked, ${documented} documented-manual, 0 violations.`);
}

main().catch((e) => { console.error("verifier error:", (e as Error).message); process.exit(1); });
