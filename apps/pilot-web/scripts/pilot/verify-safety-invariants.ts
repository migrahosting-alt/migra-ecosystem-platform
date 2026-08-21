// MigraPilot Ops-Safety Invariant verifier (Phase 12.12).
// READ-ONLY. Checks the SAFETY_INVARIANTS manifest against the live policy/registry/tool/route posture.
// No env, no network, no DB, no external services; reads only in-repo source + pure functions.
// Run: npx --yes tsx scripts/pilot/verify-safety-invariants.ts  (or: npm run pilot:safety:verify)

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { SAFETY_INVARIANTS, SAFETY_INVARIANTS_VERSION } from "../../lib/pilot/safety-invariants";
import { classifyPilotAction } from "../../lib/pilot/policy";
import { PILOT_MODES, applyModeCeiling, authorityOfMode } from "../../lib/pilot/mode-authority";
import { toTranscriptionResult } from "../../lib/pilot/transcription";
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

  // unverifiable-transcript-needs-confirmation
  {
    const provenance = { kind: "machine-transcribed" as const, audioBytes: 1, audioMime: "wav" };
    // REGRESSION GUARD, and it caught a real one. The worker pins language="en" for an .en
    // model by itself. That pin was being reported as `forced_language` and read as the
    // USER'S request, so French audio transcribed by base.en came back status "ok" with no
    // warnings — "Thank you for watching, and I will see you in the next video." — ready to
    // send as the speaker's own words. A machine default must never masquerade as a choice.
    const autoPinned = toTranscriptionResult(
      { text: "Thank you for watching, and I will see you in the next video.", model: "base.en",
        english_only: true, forced_language: "en", requested_language: null, language: "en" },
      provenance, 100,
    );
    // An EXPLICIT English request on the same model is legitimately fine.
    const explicit = toTranscriptionResult(
      { text: "Please summarize the migration document.", model: "base.en",
        english_only: true, forced_language: "en", requested_language: "en", language: "en" },
      provenance, 100,
    );
    const ok = autoPinned.status === "needs_confirmation"
      && autoPinned.warnings.some((w) => w.code === "english_only_model")
      && explicit.status === "ok";
    record("unverifiable-transcript-needs-confirmation", ok,
      `auto-pinned=${autoPinned.status} (warnings: ${autoPinned.warnings.map((w) => w.code).join(",") || "none"}), explicit-request=${explicit.status}`);
  }

  // ---- mode authority ceiling ----
  // A representative spread: an auto-run read, an approval-gated mutation, a memory write,
  // and a hard-blocked verb. The ceiling must treat each correctly in every mode.
  const MODE_PROBES = ["repo.read", "image.generate", "memory.ingest", "ops.deploy"] as const;
  const readOnlyModes = PILOT_MODES.filter((m) => authorityOfMode(m) === "read_only");

  // read-only-modes-cannot-mutate
  {
    const bad: string[] = [];
    for (const mode of readOnlyModes) {
      for (const name of MODE_PROBES) {
        const base = classifyPilotAction(name, {});
        const gated = applyModeCeiling(base, mode);
        if (base.risk === "safe_read") { if (gated.risk !== "safe_read") bad.push(`${mode}/${name} narrowed a read`); continue; }
        // Every non-read must be refused outright, and must NOT offer an approval card.
        if (!gated.blocked || gated.requiresApproval) bad.push(`${mode}/${name} blocked=${gated.blocked} approval=${gated.requiresApproval}`);
      }
    }
    record("read-only-modes-cannot-mutate", bad.length === 0,
      `${readOnlyModes.length} read-only modes x ${MODE_PROBES.length} probes; violations: ${bad.length ? bad.join("; ") : "none"}`);
  }
  // unknown-mode-fails-closed
  {
    const junk: unknown[] = [undefined, null, "", "execute", "EXECUTE", "Exec", "Plan ", 7, {}, ["Execute"], "Execute\u0000"];
    const promoted = junk.filter((m) => authorityOfMode(m) !== "read_only");
    const reachable = junk.filter((m) => !applyModeCeiling(classifyPilotAction("image.generate", {}), m).blocked);
    record("unknown-mode-fails-closed", promoted.length === 0 && reachable.length === 0,
      `${junk.length} malformed modes: ${promoted.length} gained authority, ${reachable.length} reached image.generate`);
  }
  // mode-ceiling-never-promotes
  {
    const names = Object.keys(TOOLS);
    // Execute must be a pass-through: identical decision object for every tool.
    const drift = names.filter((n) => JSON.stringify(applyModeCeiling(classifyPilotAction(n, {}), "Execute")) !== JSON.stringify(classifyPilotAction(n, {})));
    // No mode may unblock what the classifier blocked.
    const unblocked: string[] = [];
    for (const mode of PILOT_MODES) {
      for (const n of names) {
        const base = classifyPilotAction(n, {});
        if (base.blocked && !applyModeCeiling(base, mode).blocked) unblocked.push(`${mode}/${n}`);
      }
    }
    record("mode-ceiling-never-promotes", drift.length === 0 && unblocked.length === 0,
      `Execute pass-through over ${names.length} tools: ${drift.length} drifted; unblocked-by-mode: ${unblocked.length}`);
  }

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
