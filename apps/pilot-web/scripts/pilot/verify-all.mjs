// MigraPilot Unified Verification Gate (Phase 12.13).
// READ-ONLY. Composes the existing pilot verifiers — it adds no checks of its own and duplicates no
// redaction/invariant logic; it just runs them and fails closed if either fails.
//   npm run pilot:verify   (→ node scripts/pilot/verify-all.mjs)
// Runs: pilot:redaction:test (redaction harness) + pilot:safety:verify (safety-invariant manifest).
// No env, no network, no DB, no generation/write/export — only the two read-only child verifiers.

import { spawnSync } from "node:child_process";

const STEPS = [
  { name: "redaction", script: "pilot:redaction:test" },
  { name: "safety-invariants", script: "pilot:safety:verify" },
];

const results = [];
for (const step of STEPS) {
  console.log(`\n=== pilot:verify → ${step.name} (npm run ${step.script}) ===`);
  const r = spawnSync("npm", ["run", "--silent", step.script], { stdio: "inherit", env: process.env });
  results.push({ ...step, ok: r.status === 0 });
}

console.log("\n=== pilot:verify summary ===");
for (const r of results) console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}  (npm run ${r.script})`);

const allOk = results.every((r) => r.ok);
console.log(`\nPILOT VERIFY: ${allOk ? "PASS — all read-only safety gates green" : "FAIL — one or more gates failed (fail closed)"}`);
process.exit(allOk ? 0 : 1);
