/**
 * Source-tree integrity. TREE ONLY — this cannot run against an installed package, by design.
 *
 * A correct publish ships `dist` and nothing else, so a published artifact has no `src` to audit.
 * That is not a gap: it is the reason this file is separate from contract-neutrality.mjs, which
 * tests the BUILT module and therefore travels with the tarball.
 *
 * The split was forced by a real failure. The combined suite passed seven behavioural tests against
 * an installed package and then crashed on ENOENT reading src/index.ts — a suite auditing the
 * repository while its name claimed it audited the artifact. Two assertions were mixed: what the
 * code DOES, and what the tree CONTAINS. Only the first survives packaging.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
let fail = 0, notMeasured = 0;
const t = (name, cond, why) => {
  if (cond) console.log(`  PASS  ${name}`);
  else { console.log(`  FAIL  ${name}\n        ${why}`); fail = 1; }
};
const unmeasured = (name, why) => { console.log(`  NOT_MEASURED  ${name}\n        ${why}`); notMeasured++; };

console.log("=== the contract source pulls in nothing ===");

const srcPath = join(PKG, "src", "index.ts");
if (!existsSync(srcPath)) {
  /*
   * Reported, never silently skipped. If this file is ever run from an installed package the honest
   * answer is "this check does not apply here", not a pass — an unrun check is not a passing one.
   */
  unmeasured("the client imports nothing at all",
    `no src/ at ${srcPath} — this is the TREE-ONLY suite and a published artifact correctly ships none. Run contract-neutrality.mjs against artifacts.`);
} else {
  const src = readFileSync(srcPath, "utf8");
  const imports = src.match(/^\s*import\s.+$/gm) ?? [];
  t("the client imports nothing at all", imports.length === 0,
    `imports found: ${imports.join(" | ")} — a contract package that pulls in a dependency can pull in a decision`);
}

console.log("\n=== no drift while two copies exist ===");

/*
 * MigraAI-Studio holds a copy until its consumption is repointed at the published package. Two
 * copies of a contract with nothing comparing them is precisely how a contract silently forks.
 * This check is scaffolding for a migration and should be DELETED once Studio's copy is, rather
 * than kept as permanent infrastructure — a guard that outlives its migration is a fork with a
 * dashboard.
 */
const studio = process.env.MIGRAAI_STUDIO_REPO || "/mnt/e/MigraTeck/AI/MigraAI-Studio";
const studioSrc = join(studio, "packages", "compute-client", "src", "index.ts");
if (!existsSync(srcPath) || !existsSync(studioSrc)) {
  unmeasured("dev and Studio compute-client contract source is identical",
    `one side absent (dev: ${existsSync(srcPath)}, studio: ${studioSrc}) — set MIGRAAI_STUDIO_REPO to compare. Not a pass: an unchecked copy is not a matching copy.`);
} else {
  const h = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
  const a = h(srcPath), b = h(studioSrc);
  t("dev and Studio compute-client contract source is identical", a === b,
    `dev ${a.slice(0, 12)} != studio ${b.slice(0, 12)} — the contract has forked; the copies must be reconciled before either is trusted`);
}

console.log(fail ? "\nSOURCE INTEGRITY VIOLATED" : `\nSOURCE INTEGRITY HOLDS${notMeasured ? ` (${notMeasured} not measured)` : ""}`);
process.exit(fail ? 1 : 0);
