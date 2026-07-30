import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { SseTestServer, goodChatFrames } from "../harness/sseServer";
import { makeClient, runChat } from "../harness/pilotHarness";

const server = new SseTestServer();
let base = "";
beforeAll(async () => { base = await server.start(); });
afterAll(async () => { await server.stop(); });
beforeEach(() => { server.requests.length = 0; });

describe("conversation history & isolation (scenarios 25-27, 29)", () => {
  it("S25: multi-turn history is forwarded to the backend, mapped and capped at 20", async () => {
    server.respondWith({ frames: goodChatFrames({ tokens: ["ok"] }) });
    const history = Array.from({ length: 25 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as const, text: `turn${i}` }));
    const c = makeClient({ "migrapilot.pilotApiUrl": base });
    await runChat(c, "next", { history });
    const sent = server.requests[0].body.history;
    expect(Array.isArray(sent)).toBe(true);
    expect(sent.length).toBe(20); // last 20
    expect(sent[0]).toEqual({ role: history[5].role, text: "turn5" });
    expect(sent[19]).toEqual({ role: history[24].role, text: "turn24" });
  });

  it("S26: with no history (fresh chat) the request carries no history field", async () => {
    server.respondWith({ frames: goodChatFrames({ tokens: ["ok"] }) });
    const c = makeClient({ "migrapilot.pilotApiUrl": base });
    await runChat(c, "first message", { history: [] });
    expect(server.requests[0].body).not.toHaveProperty("history");
  });

  it("S27: two concurrent chats do not mix streamed state", async () => {
    // server tags tokens with the request's own message so cross-talk is detectable
    server.respondWith((req) => {
      const tag = String(req.body?.message ?? "");
      return { frames: goodChatFrames({ tokens: [`${tag}-a`, `${tag}-b`] }) };
    });
    const c = makeClient({ "migrapilot.pilotApiUrl": base });
    const [t1, t2] = await Promise.all([runChat(c, "ALPHA"), runChat(c, "BRAVO")]);
    expect(t1.fullText).toBe("ALPHA-aALPHA-b");
    expect(t2.fullText).toBe("BRAVO-aBRAVO-b");
  });

  it("S29: provider fallback metadata is visible in the transcript", async () => {
    server.respondWith({
      frames: [
        { event: "provider", data: { model: "gpt-oss:120b-cloud", reason: "primary" } },
        { event: "provider", data: { model: "llama3.1:8b", reason: "fallback" } },
        { event: "token", data: { text: "ok" } },
        { event: "done", data: {} },
      ],
    });
    const c = makeClient({ "migrapilot.pilotApiUrl": base });
    const t = await runChat(c, "hi");
    expect(t.steps.some((s) => s.includes("llama3.1:8b") && s.includes("fallback"))).toBe(true);
  });
});
