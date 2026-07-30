import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SseTestServer } from "../harness/sseServer";
import { makeClient, runChat } from "../harness/pilotHarness";

/**
 * Phase C.6.1 — the REAL PilotClient fetch + SSE frame parser consuming pilot-api's
 * `plan` and `phase` events. Only the model/server is faked; the client is not
 * reimplemented. Proves the execution plan reaches the UI even when tools run
 * (the C.6.1 defect was pilot-api discarding it once the first tool started).
 */
const server = new SseTestServer();
let base = "";
beforeAll(async () => { base = await server.start(); });
afterAll(async () => { await server.stop(); });

const PLAN = {
  source: "deterministic", title: "Execution Plan", org: "MigraTeck LLC",
  domain: "bonepetitfrere.migrateck.com",
  resolution: "I resolved bonepetitfrere.migrateck.com to MigraTeck LLC. This is an internal first-party domain.",
  status: "dry_run", note: "Waiting for approval before any infrastructure changes.",
  steps: [
    { index: 1, text: "Create Next.js application", status: "pending" },
    { index: 2, text: "Provision subdomain", status: "pending" },
    { index: 3, text: "Configure NGINX", status: "pending" },
  ],
};

describe("plan / phase SSE events", () => {
  it("surfaces the server-authored plan with the resolved ORGANIZATION NAME", async () => {
    server.respondWith({
      frames: [
        { event: "phase", data: { phase: "planning", label: "Planning" } },
        { event: "plan", data: { plan: PLAN, text: "I resolved ... to MigraTeck LLC." } },
        { event: "done", data: {} },
      ],
    });
    const t = await runChat(makeClient({ "migrapilot.pilotApiUrl": base }), "build a blog on bonepetitfrere.migrateck.com");
    expect(t.plans).toHaveLength(1);
    expect(t.plans[0].org).toBe("MigraTeck LLC");
    expect(t.plans[0].status).toBe("dry_run");
    expect(t.plans[0].steps.map((s) => s.text)).toEqual([
      "Create Next.js application", "Provision subdomain", "Configure NGINX",
    ]);
    expect(t.phases[0]).toMatchObject({ phase: "planning" });
  });

  it("the plan SURVIVES tool execution — the C.6.1 regression guard", async () => {
    server.respondWith({
      frames: [
        { event: "plan", data: { plan: PLAN, text: "plan" } },
        { event: "phase", data: { phase: "execution", step: 1, status: "running" } },
        { event: "tool", data: { type: "tool_status", toolName: "inventory.domains.map", status: "started" } },
        { event: "phase", data: { phase: "execution", step: 1, status: "done" } },
        { event: "phase", data: { phase: "completion" } },
        { event: "done", data: {} },
      ],
    });
    const t = await runChat(makeClient({ "migrapilot.pilotApiUrl": base }), "build a blog");
    expect(t.plans).toHaveLength(1);                       // plan not lost once the tool ran
    expect(t.phases.map((p) => p.phase)).toEqual(["execution", "execution", "completion"]);
    expect(t.phases[1]).toMatchObject({ step: 1, status: "done" });
    expect(t.completed).toBe(true);
  });

  it("a turn with no plan never fires onPlan, and a malformed plan is ignored", async () => {
    server.respondWith({ frames: [{ event: "token", data: { text: "hi" } }, { event: "done", data: {} }] });
    const a = await runChat(makeClient({ "migrapilot.pilotApiUrl": base }), "hello");
    expect(a.plans).toHaveLength(0);

    server.respondWith({ frames: [{ event: "plan", data: { plan: { steps: [] } } }, { event: "done", data: {} }] });
    const b = await runChat(makeClient({ "migrapilot.pilotApiUrl": base }), "hello");
    expect(b.plans).toHaveLength(0);   // empty plan rejected, no crash
    expect(b.completed).toBe(true);
  });
});
