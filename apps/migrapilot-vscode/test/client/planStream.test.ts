/**
 * Phase C.6.1 — execution plan + phase stream.
 *
 * Proves the extension renders the server-authored plan and folds live phase
 * progress into it, and that the plan never leaks an internal identifier.
 * Uses the real client code path (no reimplementation).
 */

import { describe, it, expect } from "vitest";
import {
  parsePlanEvent,
  parsePhaseEvent,
  applyPhaseToPlan,
  planGlyph,
  type ExecutionPlan,
} from "../../src/planStream";

const PLAN_EVENT = {
  plan: {
    source: "deterministic",
    title: "Execution Plan",
    org: "MigraTeck LLC",
    domain: "bonepetitfrere.migrateck.com",
    resolution:
      "I resolved bonepetitfrere.migrateck.com to MigraTeck LLC. This is an internal first-party domain.",
    status: "dry_run",
    note: "Waiting for approval before any infrastructure changes.",
    steps: [
      { index: 1, text: "Create Next.js application", status: "pending", toolPrefixes: ["repo."] },
      { index: 2, text: "Provision subdomain", status: "pending", toolPrefixes: ["domains."] },
      { index: 3, text: "Configure NGINX", status: "pending" },
      { index: 4, text: "Configure SSL", status: "pending" },
      { index: 5, text: "Register site in MigraPanel", status: "pending" },
      { index: 6, text: "Configure deployment", status: "pending" },
    ],
  },
  text: "I resolved bonepetitfrere.migrateck.com to MigraTeck LLC.",
};

describe("plan event parsing", () => {
  it("parses the server-authored plan, keeping the organization NAME", () => {
    const plan = parsePlanEvent(PLAN_EVENT)!;
    expect(plan).not.toBeNull();
    expect(plan.source).toBe("deterministic");
    expect(plan.org).toBe("MigraTeck LLC");
    expect(plan.domain).toBe("bonepetitfrere.migrateck.com");
    expect(plan.status).toBe("dry_run");
    expect(plan.steps).toHaveLength(6);
    expect(plan.steps[0]).toMatchObject({ index: 1, text: "Create Next.js application", status: "pending" });
  });

  it("never surfaces an internal identifier anywhere in the plan", () => {
    const plan = parsePlanEvent(PLAN_EVENT)!;
    const blob = JSON.stringify(plan).toLowerCase();
    for (const forbidden of ["tenantid", "podid", "zoneid", "workspaceid", "resourceid"]) {
      expect(blob).not.toContain(forbidden);
    }
  });

  it("defaults missing fields rather than throwing, and rejects an empty plan", () => {
    const plan = parsePlanEvent({ plan: { steps: [{ text: "Only step" }] } })!;
    expect(plan.title).toBe("Execution Plan");
    expect(plan.status).toBe("dry_run");
    expect(plan.org).toBeNull();
    expect(plan.steps[0]).toMatchObject({ index: 1, status: "pending" });

    expect(parsePlanEvent({ plan: { steps: [] } })).toBeNull();
    expect(parsePlanEvent(null)).toBeNull();
    expect(parsePlanEvent("garbage")).toBeNull();
  });
});

describe("phase event parsing", () => {
  it("parses the three phases and ignores anything else", () => {
    expect(parsePhaseEvent({ phase: "planning" })!.phase).toBe("planning");
    expect(parsePhaseEvent({ phase: "execution", step: 2, status: "running" })).toMatchObject({
      phase: "execution",
      step: 2,
      status: "running",
    });
    expect(parsePhaseEvent({ phase: "completion" })!.phase).toBe("completion");
    expect(parsePhaseEvent({ phase: "bogus" })).toBeNull();
    expect(parsePhaseEvent({})).toBeNull();
  });
});

describe("folding phases into the plan", () => {
  const base = () => parsePlanEvent(PLAN_EVENT)! as ExecutionPlan;

  it("entering execution starts the first pending step", () => {
    const next = applyPhaseToPlan(base(), { phase: "execution" });
    expect(next.status).toBe("executing");
    expect(next.steps[0].status).toBe("running");
    expect(next.steps[1].status).toBe("pending");
  });

  it("a step-targeted update advances exactly that step", () => {
    let plan = applyPhaseToPlan(base(), { phase: "execution", step: 1, status: "done" });
    plan = applyPhaseToPlan(plan, { phase: "execution", step: 2, status: "running" });
    expect(plan.steps[0].status).toBe("done");
    expect(plan.steps[1].status).toBe("running");
    expect(plan.steps[2].status).toBe("pending");
  });

  it("completion closes out running steps and marks the plan complete", () => {
    let plan = applyPhaseToPlan(base(), { phase: "execution" });
    plan = applyPhaseToPlan(plan, { phase: "completion" });
    expect(plan.steps[0].status).toBe("done");
    expect(plan.status).toBe("complete");
  });

  it("a failed step makes the completed plan failed, not complete", () => {
    let plan = applyPhaseToPlan(base(), { phase: "execution", step: 2, status: "failed" });
    plan = applyPhaseToPlan(plan, { phase: "completion" });
    expect(plan.status).toBe("failed");
  });

  it("never mutates the plan it was given", () => {
    const original = base();
    const snapshot = JSON.stringify(original);
    applyPhaseToPlan(original, { phase: "execution", step: 1, status: "done" });
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it("stays dry_run until execution actually begins", () => {
    expect(applyPhaseToPlan(base(), { phase: "planning" }).status).toBe("dry_run");
  });
});

describe("step glyphs", () => {
  it("maps each state to its marker", () => {
    expect(planGlyph("pending")).toBe("☐");
    expect(planGlyph("running")).toBe("▶");
    expect(planGlyph("done")).toBe("✓");
    expect(planGlyph("failed")).toBe("✗");
    expect(planGlyph("skipped")).toBe("⊘");
  });
});
