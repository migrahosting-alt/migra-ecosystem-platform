import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SseTestServer, goodChatFrames } from "../harness/sseServer";
import { makeClient, runChat } from "../harness/pilotHarness";
import { buildBackendMessage } from "../../src/extension";
import { ContextCollector } from "../../src/contextCollector";
import { Selection } from "../harness/vscodeMock";

/**
 * Full extension-to-backend smoke: builds a real user turn (editor context +
 * an attachment + selected model + prior history), sends it through the REAL
 * PilotClient against a pilot-api-shaped SSE server, and validates the emitted
 * events and the final transcript — the same code path VS Code drives.
 */
const server = new SseTestServer();
let base = "";
beforeAll(async () => { base = await server.start(); });
afterAll(async () => { await server.stop(); });

function fakeEditor(path: string, text: string, sel?: [number, number, number, number]): any {
  const uri = { fsPath: path, path, toString: () => path };
  return {
    document: {
      fileName: path, uri, languageId: "typescript", lineCount: text.split("\n").length,
      getText: (r?: any) => (r ? text.split("\n").slice(r.start.line, r.end.line + 1).join("\n") : text),
    },
    selection: sel ? new Selection(...sel) : new Selection(0, 0, 0, 0),
  };
}

describe("full extension-to-backend smoke (§2C)", () => {
  it("drives a complete coding turn end-to-end with context + model + history", async () => {
    server.respondWith((req) => {
      // echo what the server received so the smoke can assert the round trip
      return { frames: goodChatFrames({ model: "gpt-oss:120b-cloud", reason: "auto", tokens: ["The ", "bug ", "is ", "the ", "off-by-one."] }) };
    });

    const editor = fakeEditor("/home/u/workspace/proj/src/loop.ts", "for (let i = 0; i <= n; i++) {}", [0, 0, 0, 30]);
    const ctx = new ContextCollector().collectContext(editor);
    const backendMessage = buildBackendMessage("Why does this loop run one time too many?", ctx, []);

    const client = makeClient({ "migrapilot.pilotApiUrl": base });
    const history = [{ role: "user" as const, text: "hi" }, { role: "assistant" as const, text: "hello" }];
    const t = await runChat(client, backendMessage, { model: "gpt-oss:120b-cloud", history });

    // request round trip
    const sent = server.requests.at(-1)!;
    expect(sent.url).toBe("/api/pilot/chat/stream");
    expect(sent.body.dryRun).toBe(true);
    expect(sent.body.model).toBe("gpt-oss:120b-cloud");
    expect(sent.body.history).toHaveLength(2);
    expect(String(sent.body.message)).toContain("Editor context");
    expect(String(sent.body.message)).toContain("loop.ts");

    // transcript
    expect(t.steps.some((s) => s.includes("gpt-oss:120b-cloud"))).toBe(true);
    expect(t.fullText).toBe("The bug is the off-by-one.");
    expect(t.completed).toBe(true);
    expect(t.error).toBeUndefined();
  });
});
