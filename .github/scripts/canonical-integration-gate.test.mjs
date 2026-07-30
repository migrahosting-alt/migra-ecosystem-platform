import assert from "node:assert/strict";
import test from "node:test";
import {
  DORMANT_REASONS,
  GATES,
  GATE_CONTEXT,
  computeApplicability,
  evaluate,
  globToRegExp,
  pendingContexts,
} from "./lib/gate-rules.mjs";

const DORMANT = ["pale-validate", "pale-backend-checks", "pale-mobile-checks", "pilot-ci"];

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
});

// ── dormancy: defined, never required ────────────────────────────────────────────────────

test("dormant gates are never expected, even when their paths match exactly", () => {
  const { expected, dormant } = computeApplicability([
    "Software/Pale/backend/src/x.ts",
    "Software/Pale/mobile/App.tsx",
    "Software/Pale/packages/shared/i.ts",
    "apps/pilot-web/src/main.ts",
  ]);
  for (const c of DORMANT) {
    assert.ok(!expected.includes(c), `${c} must not gate merge eligibility`);
  }
  assert.deepEqual(dormant.map((d) => d.context).sort(), [...DORMANT].sort());
  // Only the always-on gates remain for a PR touching nothing but dormant scopes.
  assert.deepEqual([...expected].sort(), [...ALWAYS].sort());
});

test("dormant gates are reported with a reason, so withdrawal is never silent", () => {
  const { dormant } = computeApplicability(["apps/pilot-web/src/main.ts"]);
  for (const d of dormant) {
    assert.ok(typeof d.reason === "string" && d.reason.length > 40, `${d.context} needs a reason`);
  }
});

test("a truncated file list does NOT resurrect dormant gates", () => {
  const { expected, dormant } = computeApplicability([], true);
  for (const c of DORMANT) assert.ok(!expected.includes(c), `${c} must stay dormant`);
  assert.equal(dormant.length, DORMANT.length);
  // Fail-safe still expands the LIVE gates.
  assert.deepEqual([...expected].sort(), [...ALWAYS, "validate", "secret-scan"].sort());
});

test("every dormant reason carries explicit, non-trivial re-entry criteria", () => {
  for (const [key, r] of Object.entries(DORMANT_REASONS)) {
    assert.ok(Array.isArray(r.reentry) && r.reentry.length >= 3, `${key} needs re-entry criteria`);
    for (const c of r.reentry) assert.ok(c.length > 10, `${key} criterion too vague: ${c}`);
  }
});

test("pilot-ci re-entry demands tracked source, tracked tsconfig, clean-clone install and a live pass", () => {
  const joined = DORMANT_REASONS.PILOT_WEB_UNTRACKED.reentry.join(" | ").toLowerCase();
  for (const needle of ["source is tracked", "tsconfig", "clean-clone", "typecheck", "reports success"]) {
    assert.ok(joined.includes(needle), `re-entry criteria must mention ${needle}`);
  }
});

test("dormant gates keep their path filters recorded for the day they return", () => {
  for (const c of DORMANT) {
    const gate = GATES.find((g) => g.context === c);
    assert.ok(Array.isArray(gate.paths) && gate.paths.length > 0, `${c} lost its paths`);
    assert.ok(gate.dormant?.reason, `${c} lost its dormancy reason`);
  }
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

test("req 9: a truncated file list expects every LIVE gate rather than under-expecting", () => {
  const { expected, notApplicable, dormant } = computeApplicability([], true);
  assert.equal(notApplicable.length, 0, "nothing is dismissed as not-applicable when truncated");
  const live = GATES.filter((g) => !g.dormant);
  assert.equal(expected.length, live.length);
  assert.deepEqual([...expected].sort(), live.map((g) => g.context).sort());
  assert.equal(dormant.length, GATES.length - live.length);
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

test("overlapping Pale paths still match all three filters — dormancy, not the glob, excludes them", () => {
  const files = ["Software/Pale/packages/shared/index.ts"];
  for (const c of ["pale-validate", "pale-backend-checks", "pale-mobile-checks"]) {
    const gate = GATES.find((g) => g.context === c);
    assert.ok(
      gate.paths.some((p) => globToRegExp(p).test(files[0])),
      `${c}'s filter should still match ${files[0]}`,
    );
  }
  // ...yet none of them gate merge eligibility.
  const { expected } = computeApplicability(files);
  assert.deepEqual([...expected].sort(), [...ALWAYS].sort());
});

test("a mobile-only Pale change matches only the mobile filter", () => {
  const f = "Software/Pale/mobile/App.tsx";
  const mobile = GATES.find((g) => g.context === "pale-mobile-checks");
  const backend = GATES.find((g) => g.context === "pale-backend-checks");
  assert.ok(mobile.paths.some((p) => globToRegExp(p).test(f)));
  assert.ok(!backend.paths.some((p) => globToRegExp(p).test(f)));
});

test("a mixed PR expects the union of LIVE applicable gates only", () => {
  const { expected, dormant } = computeApplicability([
    "MigraTeck/apps/web/page.tsx",
    "apps/pilot-web/src/main.ts",
    "docs/notes.md",
  ]);
  for (const c of [...ALWAYS, "validate", "secret-scan"]) {
    assert.ok(expected.includes(c), `${c} must be expected`);
  }
  assert.ok(!expected.includes("pilot-ci"), "pilot-ci is dormant and must not gate the merge");
  assert.ok(dormant.some((d) => d.context === "pilot-ci"));
});
