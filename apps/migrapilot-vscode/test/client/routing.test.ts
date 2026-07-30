import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { SseTestServer, goodChatFrames } from "../harness/sseServer";
import { PilotClient } from "../../src/pilotClient";
import { makeClient, runChat } from "../harness/pilotHarness";
import { __resetConfig, __setConfig } from "../harness/vscodeMock";

const server = new SseTestServer();
let base = "";

beforeAll(async () => { base = await server.start(); });
afterAll(async () => { await server.stop(); });
beforeEach(() => { server.requests.length = 0; __resetConfig(); });
afterEach(() => { __resetConfig(); });

describe("routing & backend selection (scenarios 2-6, 12)", () => {
  it("S2: default backend is pilot-api at :3377 (package.json default, no override)", () => {
    __resetConfig(); // no overrides — observe the shipped defaults
    const c = new PilotClient();
    expect(c.backend()).toBe("pilot-api");
    expect(c.baseUrl()).toBe("http://127.0.0.1:3377");
  });

  it("S3: pilot-web is used only when explicitly selected, and hits the NDJSON endpoint", async () => {
    server.respondWith({ frames: [] });
    __setConfig({ "migrapilot.backend": "pilot-web", "migrapilot.apiUrl": base });
    const c = new PilotClient();
    expect(c.backend()).toBe("pilot-web");
    await runChat(c, "hi");
    expect(server.requests[0].url).toBe("/api/pilot/chat"); // NOT /stream
  });

  it("S4: Auto sends NO literal model field to pilot-api", async () => {
    server.respondWith({ frames: goodChatFrames({ tokens: ["ok"] }) });
    const c = makeClient({ "migrapilot.pilotApiUrl": base });
    await runChat(c, "hello", { model: "auto" });
    expect(server.requests[0].url).toBe("/api/pilot/chat/stream");
    expect(server.requests[0].body).not.toHaveProperty("model");
    expect(server.requests[0].body.dryRun).toBe(true); // extension always dry-runs chat
  });

  it("S4b: undefined model also omits the model field", async () => {
    server.respondWith({ frames: goodChatFrames({ tokens: ["ok"] }) });
    const c = makeClient({ "migrapilot.pilotApiUrl": base });
    await runChat(c, "hello");
    expect(server.requests[0].body).not.toHaveProperty("model");
  });

  it("S5: an explicit model is forwarded unchanged", async () => {
    server.respondWith({ frames: goodChatFrames({ tokens: ["ok"] }) });
    const c = makeClient({ "migrapilot.pilotApiUrl": base });
    await runChat(c, "hello", { model: "claude-opus-4-8" });
    expect(server.requests[0].body.model).toBe("claude-opus-4-8");
  });

  it("S6: resolved provider/model is surfaced in the transcript", async () => {
    server.respondWith({ frames: goodChatFrames({ model: "gpt-oss:120b-cloud", reason: "escalated", tokens: ["ok"] }) });
    const c = makeClient({ "migrapilot.pilotApiUrl": base });
    const t = await runChat(c, "hello");
    expect(t.steps.some((s) => s.includes("gpt-oss:120b-cloud") && s.includes("escalated"))).toBe(true);
  });

  it("S12: unreachable pilot-api surfaces an error and does NOT silently fall back to pilot-web", async () => {
    // point at a closed port; pilot-web apiUrl is set but must never be used
    const c = makeClient({ "migrapilot.pilotApiUrl": "http://127.0.0.1:1", "migrapilot.apiUrl": base });
    server.requests.length = 0;
    const t = await runChat(c, "hello");
    expect(t.error).toBeDefined();
    expect(t.completed).toBe(false);
    expect(server.requests.length).toBe(0); // pilot-web endpoint never called
  });
});
