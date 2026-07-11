import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { SseTestServer } from "../harness/sseServer";
import { makeClient, runChat } from "../harness/pilotHarness";
import { FakeProposalBackend } from "../harness/fakeProposalBackend";
import { ProposedEditController } from "../../src/proposedEdits/controller";
import { sha256 } from "../../src/proposedEdits/editSafety";
import { __resetFs, __seedFile, __readFile, __exists } from "../harness/vscodeMock";

/**
 * Headless end-to-end (§ mission §1, C.5 target flow):
 *   chat → model propose_edit → proposal SSE event → first-class card →
 *   approve → REAL WorkspaceEdit apply → rollback.
 *
 * The SSE proposal event is parsed by the REAL PilotClient; the same proposalId then
 * drives the REAL ProposedEditController + applyEngine (WorkspaceEdit) against the
 * in-memory workspace. Approval-before-apply, single-use nonce, and rollback
 * staleness are enforced by the fail-closed fake backend.
 */
const server = new SseTestServer();
let base = "";
beforeAll(async () => { base = await server.start(); });
afterAll(async () => { await server.stop(); });
beforeEach(() => { __resetFs(); });

const WS = "ws:e2e";

describe("chat → proposal card → approve → apply → rollback", () => {
  it("runs the full model-driven proposal lifecycle end-to-end", async () => {
    __seedFile("src/a.ts", "old");
    const backend = new FakeProposalBackend();

    // The backend generates + persists the proposal during the chat turn.
    const created = await backend.create({
      workspaceId: WS, title: "Refactor a.ts", explanation: "clarify logic", conversationId: "c1", missionId: "m1",
      files: [{ path: "src/a.ts", operation: "modify", originalHash: sha256("old"), proposedContent: "NEW" }],
    });
    const id = created.data!.id;

    // 1. Chat turn surfaces the proposal card over SSE (REAL client parse).
    server.respondWith({
      frames: [
        { event: "provider", data: { model: "gpt-oss:120b-cloud", reason: "auto" } },
        { event: "tool", data: { toolName: "propose_edit", status: "completed" } },
        { event: "proposal", data: {
          proposalId: id, title: "Refactor a.ts", filesAffected: 1, linesAdded: 1, linesRemoved: 1,
          risk: "MEDIUM", model: "gpt-oss:120b-cloud", expiresAt: created.data!.expiresAt,
          summary: "clarify logic", destructive: false, sensitive: false, workspaceId: WS,
        } },
        { event: "token", data: { text: "I proposed a refactor of src/a.ts for your review." } },
        { event: "done", data: { ok: true } },
      ],
    });
    const t = await runChat(makeClient({ "migrapilot.pilotApiUrl": base }), "refactor src/a.ts", { workspaceId: WS });
    expect(t.proposals).toHaveLength(1);
    expect(t.proposals[0].proposalId).toBe(id);

    // 2. Card buttons drive the REAL controller flow.
    const statuses: string[] = [];
    const controller = new ProposedEditController(backend as any, { onStatus: (_id, s) => statuses.push(s) });

    // apply BEFORE approval is fail-closed (no write).
    const early = await controller.apply(id, WS);
    expect(early.ok).toBe(false);
    expect(early.reasons?.some((r) => r.startsWith("not_approved"))).toBe(true);
    expect(__readFile("src/a.ts")).toBe("old"); // untouched

    // approve → apply (REAL WorkspaceEdit writes to the in-memory workspace).
    const approved = await controller.approve(id, WS);
    expect(approved.status).toBe("approved");
    const applied = await controller.apply(id, WS);
    expect(applied.ok).toBe(true);
    expect(applied.status).toBe("applied");
    expect(__readFile("src/a.ts")).toBe("NEW"); // file actually changed on disk
    expect(statuses).toContain("rollback_available");

    // 3. Rollback restores the pre-apply content.
    const rolled = await controller.rollback(id);
    expect(rolled.ok).toBe(true);
    expect(rolled.status).toBe("rolled_back");
    expect(__readFile("src/a.ts")).toBe("old");
  });

  it("a rejected proposal can never be applied (no orphan write)", async () => {
    __seedFile("src/b.ts", "keep");
    const backend = new FakeProposalBackend();
    const created = await backend.create({
      workspaceId: WS, title: "t", explanation: "e",
      files: [{ path: "src/b.ts", operation: "modify", originalHash: sha256("keep"), proposedContent: "CHANGED" }],
    });
    const id = created.data!.id;
    const controller = new ProposedEditController(backend as any, {});

    await controller.reject(id, "not needed");
    const r = await controller.apply(id, WS);
    expect(r.ok).toBe(false);
    expect(__readFile("src/b.ts")).toBe("keep"); // never written
    expect(__exists("src/b.ts")).toBe(true);
  });
});
