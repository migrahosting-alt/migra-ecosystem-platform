import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { SseTestServer, goodChatFrames } from "../harness/sseServer";
import { makeClient, runChat } from "../harness/pilotHarness";

const server = new SseTestServer();
let base = "";
beforeAll(async () => { base = await server.start(); });
afterAll(async () => { await server.stop(); });
beforeEach(() => { server.requests.length = 0; });

describe("streaming, tool/usage events, errors, malformed frames (7-9, 11, 30)", () => {
  it("S7: tokens render in order and concatenate to the final text", async () => {
    server.respondWith({ frames: goodChatFrames({ tokens: ["Hello", ", ", "world", "!"] }) });
    const c = makeClient({ "migrapilot.pilotApiUrl": base });
    const t = await runChat(c, "hi");
    expect(t.deltas).toEqual(["Hello", ", ", "world", "!"]);
    expect(t.fullText).toBe("Hello, world!");
  });

  it("S7b: tokens split arbitrarily across TCP chunks still parse correctly", async () => {
    // one SSE frame delivered as raw bytes broken mid-frame across writes
    server.respondWith({
      frames: [
        { event: "provider", data: { model: "m", reason: "auto" } },
        { raw: "event: token\nda", event: "token" },
        { raw: "ta: {\"text\":\"AB\"}\n\n", event: "token" },
        { event: "token", data: { text: "CD" } },
        { event: "done", data: {} },
      ],
    });
    const c = makeClient({ "migrapilot.pilotApiUrl": base });
    const t = await runChat(c, "hi");
    expect(t.fullText).toBe("ABCD");
  });

  /**
   * Phase D. Before this, a live mutation ended the turn with a message and no way to proceed.
   * The card is the whole feature: it must carry the EXACT action — tool, real args, tenant, and
   * whether this is LIVE — because that is what the operator is consenting to.
   */
  it("Phase D: an approval_request renders a card carrying the EXACT action", async () => {
    server.respondWith({
      frames: [
        { event: "approval_request", data: {
            pendingActionId: "pa-1", approvalId: "ap-1", toolName: "dns.deleteRecord",
            summary: "Delete record: example.com — THIS CANNOT BE UNDONE",
            args: { tenantId: "t1", domain: "example.com", type: "A" },
            mode: "live", tenantScope: "t1", expiresAt: "2030-01-01T00:00:00.000Z",
        } },
        { event: "done", data: {} },
      ],
    });
    const c = makeClient({ "migrapilot.pilotApiUrl": base });
    const t = await runChat(c, "delete it");

    expect(t.approvals).toHaveLength(1);
    const card = t.approvals[0]!;
    expect(card.pendingActionId).toBe("pa-1");
    expect(card.toolName).toBe("dns.deleteRecord");
    expect(card.mode).toBe("live");                       // never silently a dry run
    expect(card.summary).toMatch(/CANNOT BE UNDONE/);     // destructive, said out loud
    expect(card.args).toEqual({ tenantId: "t1", domain: "example.com", type: "A" }); // the REAL args
  });

  it("S8: tool-state events render, including an approval-required tool", async () => {
    server.respondWith({
      frames: [
        { event: "provider", data: { model: "m" } },
        { event: "tool", data: { toolName: "test.searchWorkspace", status: "running" } },
        { event: "tool", data: { toolName: "test.liveMutation", payload: { approvalRequest: { toolName: "test.liveMutation" } } } },
        { event: "done", data: {} },
      ],
    });
    const c = makeClient({ "migrapilot.pilotApiUrl": base });
    const t = await runChat(c, "do it");
    expect(t.steps.some((s) => s.includes("test.searchWorkspace") && s.includes("running"))).toBe(true);
    /* The step must still name the tool that needs approval. It used to read "Approval required
     * … (enable live execution to allow)" — a dead end, with nothing to click. It now points at
     * the approval CARD, which carries the exact action and the buttons. The intent of this
     * assertion is unchanged; only the wording it pinned was the defect. */
    expect(t.steps.some((s) => /approval/i.test(s) && s.includes("test.liveMutation"))).toBe(true);
  });

  it("S9: usage metadata frame does not corrupt the stream (captured, non-fatal)", async () => {
    server.respondWith({ frames: goodChatFrames({ tokens: ["done"], usage: { inputTokens: 42, outputTokens: 7 } }) });
    const c = makeClient({ "migrapilot.pilotApiUrl": base });
    const t = await runChat(c, "hi");
    expect(t.fullText).toBe("done");
    expect(t.completed).toBe(true);
    expect(t.error).toBeUndefined();
  });

  it("S11: a backend 500 shows a recoverable error including the status", async () => {
    server.respondWith({ status: 500, errorBody: "boom" });
    const c = makeClient({ "migrapilot.pilotApiUrl": base });
    const t = await runChat(c, "hi");
    expect(t.error).toMatch(/500/);
    expect(t.completed).toBe(false);
  });

  it("S11b: a mid-stream error event surfaces and stops the stream", async () => {
    server.respondWith({
      frames: [
        { event: "provider", data: { model: "m" } },
        { event: "token", data: { text: "partial" } },
        { event: "error", data: { message: "model exploded" } },
        { event: "token", data: { text: "SHOULD_NOT_APPEAR" } },
      ],
    });
    const c = makeClient({ "migrapilot.pilotApiUrl": base });
    const t = await runChat(c, "hi");
    expect(t.error).toBe("model exploded");
    expect(t.completed).toBe(false);
    expect(t.deltas.join("")).toBe("partial");
  });

  it("S30: malformed SSE frames are skipped without crashing", async () => {
    server.respondWith({
      frames: [
        { event: "provider", data: { model: "m" } },
        { raw: "event: token\ndata: {not json}\n\n", event: "token" }, // bad JSON → skipped
        { raw: "event: token\n\n", event: "token" },                    // no data → skipped
        { event: "token", data: { text: "survived" } },
        { event: "done", data: {} },
      ],
    });
    const c = makeClient({ "migrapilot.pilotApiUrl": base });
    const t = await runChat(c, "hi");
    expect(t.fullText).toBe("survived");
    expect(t.error).toBeUndefined();
  });
});
