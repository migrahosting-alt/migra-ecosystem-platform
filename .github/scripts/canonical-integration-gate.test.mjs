import assert from "node:assert/strict";
import test from "node:test";
import {
  GATES,
  GATE_CONTEXT,
  computeApplicability,
  evaluate,
  globToRegExp,
  pendingContexts,
} from "./lib/gate-rules.mjs";

/**
 * Tests for the canonical integration gate's decision rules.
 *
 * These map 1:1 onto the gate's stated requirements, because the whole point of a required check
 * is that it cannot be satisfied by accident.
 */

const ALWAYS = ["guard-bootstrap", "fresh-clone-proof", "nginx-gate", "Workspace Hygiene (Strict)"];

const completed = (conclusion) => ({ status: "completed", conclusion });
const runsFor = (map) => new Map(Object.entries(map));

// ── requirement 1: always starts, and always expects the unfiltered gates ────────────────

test("req 1: a documentation-only PR still expects every always-on gate", () => {
  const { expected, notApplicable } = computeApplicability(["docs/some-note.md"]);
  for (const c of ALWAYS) assert.ok(expected.includes(c), `${c} must be expected`);
  assert.ok(notApplicable.includes("validate"), "platform validate is not applicable");
  assert.ok(notApplicable.includes("pale-validate"));
  assert.ok(notApplicable.includes("pilot-ci"));
});

test("req 1: an unrelated-path PR still expects the always-on gates", () => {
  const { expected } = computeApplicability(["README.md", "infra/notes.txt"]);
  assert.deepEqual([...expected].sort(), [...ALWAYS].sort());
});

// ── requirement 3: every applicable check must succeed ───────────────────────────────────

test("req 3: all applicable succeed => no failures", () => {
  const { expected } = computeApplicability(["MigraTeck/apps/web/x.ts"]);
  const runs = runsFor(Object.fromEntries(expected.map((c) => [c, completed("success")])));
  assert.equal(evaluate(expected, runs).failures.length, 0);
});

test("req 3: a MigraTeck change expects platform validate and secret-scan", () => {
  const { expected } = computeApplicability(["MigraTeck/packages/config/package.json"]);
  assert.ok(expected.includes("validate"));
  assert.ok(expected.includes("secret-scan"));
});

test("req 3: editing the platform workflow itself expects platform validate", () => {
  const { expected } = computeApplicability([".github/workflows/migrateck-platform-ci.yml"]);
  assert.ok(expected.includes("validate"));
});

// ── requirement 4: skipped path-specific checks are not applicable, not failures ─────────

test("req 4: a skipped conclusion on an applicable gate is not a failure", () => {
  const expected = ["nginx-gate"];
  const { failures } = evaluate(expected, runsFor({ "nginx-gate": completed("skipped") }));
  assert.equal(failures.length, 0);
});

test("req 4: path-filtered gates are never waited on when their paths are untouched", () => {
  const { expected } = computeApplicability(["docs/x.md"]);
  // Nothing pending even though no Pale/platform runs exist at all.
  assert.deepEqual(pendingContexts(expected, runsFor({})).sort(), [...ALWAYS].sort());
  const { notApplicable } = computeApplicability(["docs/x.md"]);
  assert.equal(pendingContexts(notApplicable, runsFor({})).length, notApplicable.length);
});

// ── requirement 5: missing / cancelled / timed out / unsuccessful all fail ───────────────

for (const bad of ["failure", "cancelled", "timed_out", "action_required", "stale"]) {
  test(`req 5: conclusion "${bad}" fails the gate`, () => {
    const { failures } = evaluate(["nginx-gate"], runsFor({ "nginx-gate": completed(bad) }));
    assert.equal(failures.length, 1);
    assert.equal(failures[0].conclusion, bad);
  });
}

test("req 5: a missing applicable check fails rather than passing", () => {
  const { failures } = evaluate(["nginx-gate"], runsFor({}));
  assert.equal(failures.length, 1);
  assert.equal(failures[0].conclusion, "MISSING");
});

test("req 5: an unrecognised future conclusion is treated as a failure, not a pass", () => {
  const { failures } = evaluate(["nginx-gate"], runsFor({ "nginx-gate": completed("brand_new") }));
  assert.equal(failures.length, 1);
});

// ── requirement 6: one unique stable context name ────────────────────────────────────────

test("req 6: the gate context is unique and is not `validate`", () => {
  assert.equal(GATE_CONTEXT, "canonical-integration-gate");
  assert.ok(!GATES.some((g) => g.context === GATE_CONTEXT), "the gate must not observe itself");
});

// ── requirement 7: no duplicate context names in the table ──────────────────────────────

test("req 7: every observed context name is distinct", () => {
  const names = GATES.map((g) => g.context);
  assert.equal(new Set(names).size, names.length, `duplicate context in table: ${names}`);
  assert.ok(names.includes("pale-validate"), "renamed Pale validation is observed");
  assert.ok(names.includes("pale-backend-checks"));
  assert.ok(names.includes("pale-mobile-checks"));
  assert.ok(!names.includes("Typecheck & Lint"), "the duplicated Pale name must be gone");
});

// ── requirement 9: never pass because a workflow failed to start ─────────────────────────

test("req 9: an applicable gate still in progress is pending, never a pass", () => {
  const runs = runsFor({ "nginx-gate": { status: "in_progress", conclusion: null } });
  assert.deepEqual(pendingContexts(["nginx-gate"], runs), ["nginx-gate"]);
});

test("req 9: queued counts as pending", () => {
  const runs = runsFor({ "nginx-gate": { status: "queued", conclusion: null } });
  assert.deepEqual(pendingContexts(["nginx-gate"], runs), ["nginx-gate"]);
});

test("req 9: a truncated file list expects EVERY gate rather than under-expecting", () => {
  const { expected, notApplicable } = computeApplicability([], true);
  assert.equal(notApplicable.length, 0);
  assert.equal(expected.length, GATES.length);
});

// ── path-matching semantics ──────────────────────────────────────────────────────────────

test("glob: ** crosses directory separators", () => {
  const re = globToRegExp("MigraTeck/**");
  assert.ok(re.test("MigraTeck/a.ts"));
  assert.ok(re.test("MigraTeck/apps/web/src/deep/a.ts"));
  assert.ok(!re.test("Other/MigraTeck/a.ts"));
});

test("glob: an exact file path matches only itself", () => {
  const re = globToRegExp(".github/workflows/migrateck-platform-ci.yml");
  assert.ok(re.test(".github/workflows/migrateck-platform-ci.yml"));
  assert.ok(!re.test(".github/workflows/pale-ci.yml"));
});

test("glob: dots are literal, not wildcards", () => {
  const re = globToRegExp(".github/workflows/pale-ci.yml");
  assert.ok(!re.test("xgithub/workflows/pale-ciXyml"));
});

test("overlapping Pale paths expect BOTH backend and mobile checks", () => {
  const { expected } = computeApplicability(["Software/Pale/packages/shared/index.ts"]);
  assert.ok(expected.includes("pale-backend-checks"));
  assert.ok(expected.includes("pale-mobile-checks"));
  assert.ok(expected.includes("pale-validate"), "Software/Pale/** also matches");
});

test("a mobile-only Pale change does not expect the backend checks", () => {
  const { expected, notApplicable } = computeApplicability(["Software/Pale/mobile/App.tsx"]);
  assert.ok(expected.includes("pale-mobile-checks"));
  assert.ok(notApplicable.includes("pale-backend-checks"));
});

test("a mixed PR expects the union of applicable gates", () => {
  const { expected } = computeApplicability([
    "MigraTeck/apps/web/page.tsx",
    "apps/pilot-web/src/main.ts",
    "docs/notes.md",
  ]);
  for (const c of [...ALWAYS, "validate", "secret-scan", "pilot-ci"]) {
    assert.ok(expected.includes(c), `${c} must be expected`);
  }
  assert.ok(!expected.includes("pale-validate"));
});
