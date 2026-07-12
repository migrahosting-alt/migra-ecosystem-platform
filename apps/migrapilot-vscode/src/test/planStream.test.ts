import { test } from "node:test";
import assert from "node:assert/strict";
import {
  consumePlanProse,
  applyPhaseToPlan,
  planGlyph,
  parseSseFrame,
  type ExecutionPlan,
} from "../planStream";

/**
 * Client rendering of the execution plan + phased progress (pilot-api Phase C.6.1).
 *
 * THE DEFECT THIS SURFACE EXISTS FOR: pilot-api emitted an execution plan and its own chat
 * transport then deleted it the instant a tool ran, so the operator never saw a plan for
 * any request that actually did something. pilot-api now emits the plan as a structured
 * `plan` SSE event BEFORE any tool runs, plus `phase` events carrying per-step progress.
 * These tests pin the client half of that contract.
 */

const PLAN: ExecutionPlan = {
  source: "deterministic",
  title: "Execution Plan",
  org: "MigraTeck LLC",
  domain: "bonepetitfrere.migrateck.com",
  resolution: "I resolved bonepetitfrere.migrateck.com to MigraTeck LLC.\nThis is an internal first-party domain.",
  steps: [
    { index: 1, text: "Create Next.js application", status: "pending" },
    { index: 2, text: "Provision subdomain", status: "pending" },
    { index: 3, text: "Configure NGINX", status: "pending" },
  ],
  status: "dry_run",
  note: "Waiting for approval before any infrastructure changes.",
};

/* ── SSE framing ── */

test("parses the plan frame pilot-api actually sends", () => {
  const frame = `event: plan\ndata: ${JSON.stringify({ plan: PLAN, text: "Execution Plan" })}`;
  const parsed = parseSseFrame(frame);
  assert.equal(parsed?.event, "plan");
  assert.equal(parsed?.data.plan.org, "MigraTeck LLC");
  assert.equal(parsed?.data.plan.status, "dry_run");
});

test("parses the phase frame, including per-step progress", () => {
  const frame = `event: phase\ndata: ${JSON.stringify({ phase: "execution", label: "Executing", step: 2, stepText: "Provision subdomain", status: "done" })}`;
  const parsed = parseSseFrame(frame);
  assert.equal(parsed?.event, "phase");
  assert.equal(parsed?.data.step, 2);
  assert.equal(parsed?.data.status, "done");
});

test("ignores a malformed frame instead of throwing mid-stream", () => {
  assert.equal(parseSseFrame("event: plan\ndata: {not json"), null);
  assert.equal(parseSseFrame("event: plan"), null);
});

/* ── Plan prose de-duplication ── */

test("suppresses the duplicate plan prose across arbitrary chunk boundaries", () => {
  // pilot-api sends the plan text in 280-char chunks; the card already shows it.
  const proseText = "Execution Plan\n☐ Create Next.js application\n\nStatus: Dry Run\n\n";
  let pending = proseText;
  let shown = "";
  for (const chunk of ["Execution Pl", "an\n☐ Create Next.js app", "lication\n\nStatus: Dry Run\n\n"]) {
    const r = consumePlanProse(pending, chunk);
    pending = r.pending;
    shown += r.visible;
  }
  assert.equal(shown, "", "the plan prose must not be duplicated into the message body");
  assert.equal(pending, "");
});

test("passes the real answer through once the plan prose is consumed", () => {
  let pending = "Plan\n\n";
  const a = consumePlanProse(pending, "Plan\n\nThe blog is ready.");
  assert.equal(a.visible, "The blog is ready.");
  assert.equal(a.pending, "");
});

test("shows everything if the stream diverges — never swallow real content", () => {
  const r = consumePlanProse("Execution Plan\n", "Something else entirely");
  assert.equal(r.visible, "Something else entirely");
  assert.equal(r.pending, "");
});

/* ── Phased progress ── */

test("ticks exactly the step the backend reported done", () => {
  const next = applyPhaseToPlan(PLAN, {
    phase: "execution", label: "Executing", step: 2, stepText: "Provision subdomain", status: "done",
  });
  assert.equal(next.steps[1].status, "done");
  assert.equal(next.steps[0].status, "pending");
  assert.equal(next.steps[2].status, "pending");
  assert.equal(PLAN.steps[1].status, "pending", "the original plan must not be mutated");
});

test("a phase change with no step ticks nothing (data honesty)", () => {
  const next = applyPhaseToPlan(PLAN, { phase: "completion", label: "Complete" });
  assert.deepEqual(next.steps.map((s) => s.status), ["pending", "pending", "pending"]);
});

test("a phase naming an unknown step ticks nothing", () => {
  const next = applyPhaseToPlan(PLAN, { phase: "execution", label: "Executing", step: 99, status: "done" });
  assert.deepEqual(next.steps.map((s) => s.status), ["pending", "pending", "pending"]);
});

test("glyphs never show ✓ for a step that is not done", () => {
  assert.equal(planGlyph("pending"), "☐");
  assert.equal(planGlyph("running"), "▶");
  assert.equal(planGlyph("done"), "✓");
  assert.equal(planGlyph("failed"), "✗");
  assert.notEqual(planGlyph("pending"), "✓");
});

/* ── Safety: no internal identifiers ── */

test("the plan the client renders carries an organization NAME, never an id", () => {
  const rendered = [PLAN.resolution, ...PLAN.steps.map((s) => s.text), PLAN.note].join("\n");
  assert.match(rendered, /MigraTeck LLC/);
  assert.doesNotMatch(rendered, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  assert.doesNotMatch(rendered, /tenant\s*id/i);
});

test("the plan is dry-run and says so", () => {
  assert.equal(PLAN.status, "dry_run");
  assert.match(PLAN.note, /approval/i);
});
