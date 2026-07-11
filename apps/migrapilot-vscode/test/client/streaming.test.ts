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
    expect(t.steps.some((s) => s.includes("Approval required") && s.includes("test.liveMutation"))).toBe(true);
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
