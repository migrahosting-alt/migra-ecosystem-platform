import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Guards the AnnouPale overview product decision, and the dead code removed alongside it.
 *
 * Canonical commit 72b926a — "honest AnnouPale link status (no false Unreachable)" — decided
 * that `/console/annoupale` explains AnnouPale runs on infrastructure the console host cannot
 * reach, rather than reporting a health status it cannot truthfully measure from here.
 *
 * The historical alternative drove that page from `loadOverview()`: live bridge health plus
 * cross-queue aggregation. That is a legitimate product model, but a DIFFERENT one, and
 * adopting it silently would replace an intentional honesty decision with a status the page
 * may not be able to substantiate. `overview.ts` was therefore removed rather than left
 * dormant — dormant code is adopted by accident.
 *
 * These tests fail if the page quietly switches models, or if the removed symbols return.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CONSOLE_ROOT = join(HERE, "..", "..");
const SRC_ROOT = join(CONSOLE_ROOT, "..", "..");
const SELF = fileURLToPath(import.meta.url);

const sources = (dir: string): string[] => {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".next") continue;
    const f = join(dir, e);
    if (statSync(f).isDirectory()) out.push(...sources(f));
    else if (/\.(ts|tsx)$/.test(e)) out.push(f);
  }
  return out;
};
const ALL = sources(SRC_ROOT).filter((f) => f !== SELF);
const overviewPage = () => readFileSync(join(CONSOLE_ROOT, "annoupale", "page.tsx"), "utf8");

// ── the product decision ─────────────────────────────────────────────────────

test("the overview page still presents canonical honest-link-status behaviour", () => {
  const src = overviewPage();
  assert.match(
    src,
    /getAnnoupaleLinkStatus|ANNOUPALE_LINKS/,
    "the page must keep sourcing its status from the canonical link-status helper",
  );
  assert.match(
    src,
    /not reachable from the console host/i,
    "the honest explanation from 72b926a must remain on the page",
  );
});

test("the overview page has NOT switched to the loadOverview model", () => {
  const src = overviewPage();
  assert.ok(!src.includes("loadOverview"), "adopting loadOverview is a product decision, not a refactor");
  assert.ok(!src.includes("annoupale/overview"), "the removed module must not be reintroduced here");
  assert.ok(
    !/health\.reachable/.test(src),
    "driving status from bridge health is the alternative model — it needs an explicit decision",
  );
});

test("lib/annoupale/overview.ts is absent and unreferenced", () => {
  assert.equal(existsSync(join(HERE, "overview.ts")), false, "overview.ts must stay removed");
  for (const f of ALL) {
    assert.ok(
      !readFileSync(f, "utf8").includes("annoupale/overview"),
      `${relative(SRC_ROOT, f)} imports the removed overview module`,
    );
  }
});

test("overview.ts's dependencies survive — only the aggregator was removed", () => {
  // Most have independent consumers. attention-contract.ts is the exception: overview.ts was
  // its only RUNTIME importer, so removing the aggregator left it a cascade orphan with test
  // coverage but no caller. It is retained deliberately — deleting a dependency as collateral
  // of removing its consumer is a separate decision, and its contract tests still pass.
  for (const dep of [
    "compliance.ts",
    "compliance-appeals.ts",
    "moderation.ts",
    "audit.ts",
    "health.ts",
    "attention-contract.ts",
    "compliance-contract.ts",
  ]) {
    assert.ok(existsSync(join(HERE, dep)), `${dep} must remain`);
  }
});

// ── the dead compliance-action form ──────────────────────────────────────────

test("only the live triage form provides compliance case mutations", () => {
  const casePage = readFileSync(
    join(CONSOLE_ROOT, "annoupale", "compliance", "[caseId]", "page.tsx"),
    "utf8",
  );
  assert.match(casePage, /AnnoupaleCaseTriageForm/, "the triage form is the live mutation surface");
  assert.ok(!casePage.includes("AnnoupaleCaseActionsForm"), "the dead form must not return");

  // Exactly one component renders case mutations, so there is no second path to keep in sync.
  const renderers = ALL.filter(
    (f) => /components\/.*(CaseActionsForm|CaseTriageForm)\.tsx$/.test(f),
  ).map((f) => relative(CONSOLE_ROOT, f));
  assert.deepEqual(renderers, ["components/annoupale/AnnoupaleCaseTriageForm.tsx"]);
});

test("no import of AnnoupaleCaseActionsForm remains anywhere", () => {
  assert.equal(
    existsSync(join(CONSOLE_ROOT, "components", "AnnoupaleCaseActionsForm.tsx")),
    false,
    "the file must stay deleted",
  );
  for (const f of ALL) {
    assert.ok(
      !readFileSync(f, "utf8").includes("AnnoupaleCaseActionsForm"),
      `${relative(SRC_ROOT, f)} still references the deleted form`,
    );
  }
});

test("updateCaseStatusAction is gone — no export, no import, no call", () => {
  for (const f of ALL) {
    assert.ok(
      !readFileSync(f, "utf8").includes("updateCaseStatusAction"),
      `${relative(SRC_ROOT, f)} still references the removed action`,
    );
  }
});

test("the live case actions survive untouched", () => {
  // Removing the dead action must not have taken its neighbours with it.
  const actions = readFileSync(join(HERE, "status-actions.ts"), "utf8");
  assert.match(actions, /export async function updateCaseAction\(/);
  assert.match(actions, /export async function closeCaseAction\(/);
});
