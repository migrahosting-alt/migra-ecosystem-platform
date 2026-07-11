import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SseTestServer } from "../harness/sseServer";
import { makeClient, runChat } from "../harness/pilotHarness";

/**
 * PilotClient SSE parsing of the Phase C.5 `proposal` event. The REAL client fetch +
 * frame parser run against a pilot-api-shaped SSE server; only the model is faked.
 * Proves: the card is surfaced with the exact metadata fields, workspaceId is sent
 * upstream, a no-proposal turn never fires onProposal, and an aborted turn leaves
 * no orphan card.
 */
const server = new SseTestServer();
let base = "";
beforeAll(async () => { base = await server.start(); });
afterAll(async () => { await server.stop(); });

function proposalFrame(over: Record<string, unknown> = {}) {
  return {
    event: "proposal",
    data: {
      proposalId: "pe_1", title: "Refactor parseConfig", filesAffected: 2, linesAdded: 12, linesRemoved: 5,
      risk: "MEDIUM", model: "gpt-oss:120b-cloud", expiresAt: new Date(Date.now() + 3600e3).toISOString(),
      summary: "split parseConfig into helpers", destructive: false, sensitive: false, workspaceId: "ws:abc", ...over,
    },
  };
}

describe("proposal SSE event parsing (§2)", () => {
  it("surfaces a proposal card with the full metadata and forwards workspaceId", async () => {
    server.respondWith({
      frames: [
        { event: "conversation", data: { conversationId: "c1" } },
        { event: "provider", data: { model: "gpt-oss:120b-cloud", reason: "auto" } },
        { event: "tool", data: { toolName: "propose_edit", status: "completed" } },
        proposalFrame(),
        { event: "token", data: { text: "Proposed a refactor for your review." } },
        { event: "done", data: { ok: true } },
      ],
    });
    const client = makeClient({ "migrapilot.pilotApiUrl": base });
    const t = await runChat(client, "refactor parseConfig", { workspaceId: "ws:abc" });

    expect(server.requests.at(-1)!.body.workspaceId).toBe("ws:abc");
    expect(t.proposals).toHaveLength(1);
    const card = t.proposals[0];
    expect(card).toMatchObject({
      proposalId: "pe_1", title: "Refactor parseConfig", filesAffected: 2, linesAdded: 12, linesRemoved: 5,
      risk: "MEDIUM", model: "gpt-oss:120b-cloud", destructive: false, sensitive: false, workspaceId: "ws:abc",
    });
    expect(t.fullText).toContain("Proposed a refactor");
    expect(t.completed).toBe(true);
  });

  it("flags destructive + secret proposals", async () => {
    server.respondWith({
      frames: [
        proposalFrame({ proposalId: "pe_2", destructive: true, sensitive: true, risk: "HIGH" }),
        { event: "done", data: { ok: true } },
      ],
    });
    const t = await runChat(makeClient({ "migrapilot.pilotApiUrl": base }), "delete the old module and edit .env");
    expect(t.proposals[0]).toMatchObject({ proposalId: "pe_2", destructive: true, sensitive: true, risk: "HIGH" });
  });

  it("does NOT fire onProposal for a plain chat turn (no proposal minted)", async () => {
    server.respondWith({
      frames: [
        { event: "provider", data: { model: "m", reason: "auto" } },
        { event: "token", data: { text: "The file lives at src/index.ts." } },
        { event: "done", data: { ok: true } },
      ],
    });
    const t = await runChat(makeClient({ "migrapilot.pilotApiUrl": base }), "where is the entry point?");
    expect(t.proposals).toHaveLength(0);
    expect(t.completed).toBe(true);
  });

  it("ignores a malformed proposal frame missing a proposalId", async () => {
    server.respondWith({
      frames: [
        { event: "proposal", data: { title: "no id" } },
        { event: "done", data: { ok: true } },
      ],
    });
    const t = await runChat(makeClient({ "migrapilot.pilotApiUrl": base }), "change something");
    expect(t.proposals).toHaveLength(0);
  });

  it("an aborted turn surfaces no proposal card (no orphan) — §30", async () => {
    server.respondWith({ frames: [{ event: "conversation", data: { conversationId: "c1" }, delayMs: 40 }, proposalFrame(), { event: "done", data: {} }], hang: true });
    const ctrl = new AbortController();
    const client = makeClient({ "migrapilot.pilotApiUrl": base });
    const p = runChat(client, "refactor now", { signal: ctrl.signal });
    ctrl.abort();
    const t = await p;
    expect(t.aborted).toBe(true);
    expect(t.proposals).toHaveLength(0);
  });
});
