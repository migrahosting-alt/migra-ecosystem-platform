import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { SseTestServer } from "../harness/sseServer";
import { makeClient, runChat, Transcript } from "../harness/pilotHarness";

const server = new SseTestServer();
let base = "";
beforeAll(async () => { base = await server.start(); });
afterAll(async () => { await server.stop(); });
beforeEach(() => { server.requests.length = 0; });

describe("cancellation (scenarios 10, 28)", () => {
  it("S10: aborting mid-stream stops the request and fires onAborted", async () => {
    server.respondWith({
      hang: true,
      frames: [
        { event: "provider", data: { model: "m" } },
        { event: "token", data: { text: "partial-" }, delayMs: 0 },
        { event: "token", data: { text: "SHOULD_NOT_ARRIVE" }, delayMs: 5000 },
      ],
    });
    const c = makeClient({ "migrapilot.pilotApiUrl": base });
    const ctrl = new AbortController();
    const t = new Transcript();
    const p = c.streamChat("hi", undefined, t.handlers(), undefined, undefined, ctrl.signal);
    // wait until the first token has actually been rendered, then abort — this
    // is deterministic (polls the transcript) rather than racing a fixed timer.
    const deadline = Date.now() + 4000;
    while (t.deltas.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    ctrl.abort();
    await p;
    expect(t.aborted).toBe(true);
    expect(t.deltas.join("")).toBe("partial-");
  });

  it("S28: a cancelled request appends NO false completion (no onDone, no onError)", async () => {
    server.respondWith({ hang: true, frames: [{ event: "token", data: { text: "x" }, delayMs: 3000 }] });
    const c = makeClient({ "migrapilot.pilotApiUrl": base });
    const ctrl = new AbortController();
    const t = new Transcript();
    const p = c.streamChat("hi", undefined, t.handlers(), undefined, undefined, ctrl.signal);
    ctrl.abort();
    await p;
    expect(t.completed).toBe(false);
    expect(t.error).toBeUndefined();
    expect(t.aborted).toBe(true);
  });

  it("S28b: a signal already aborted before send never contacts the backend", async () => {
    server.requests.length = 0;
    const c = makeClient({ "migrapilot.pilotApiUrl": base });
    const ctrl = new AbortController();
    ctrl.abort();
    const t = new Transcript();
    await c.streamChat("hi", undefined, t.handlers(), undefined, undefined, ctrl.signal);
    expect(t.aborted).toBe(true);
    expect(t.completed).toBe(false);
    expect(server.requests.length).toBe(0);
  });
});
