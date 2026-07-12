import { describe, it, expect, beforeEach } from "vitest";
import { activate } from "../../src/extension";
import { commands, Uri } from "../harness/vscodeMock";

function fakeContext(): any {
  // Mirror the real ExtensionContext: VS Code always supplies workspaceState. Omitting it
  // let a crash-on-activate slip through (D.1 reads it for the active conversation id).
  const store = new Map<string, unknown>();
  return {
    subscriptions: [] as any[],
    extensionUri: Uri.file("/ext"),
    workspaceState: {
      get: (k: string) => store.get(k),
      update: async (k: string, v: unknown) => { v === undefined ? store.delete(k) : store.set(k, v); },
      keys: () => [...store.keys()],
    },
  };
}

describe("extension activation (scenario 1)", () => {
  beforeEach(() => { commands._registered.clear(); });

  it("S1: canonical extension activates and registers each command exactly once (no duplicates)", () => {
    expect(() => activate(fakeContext())).not.toThrow();
    const ids = [...commands._registered.keys()].sort();
    expect(ids).toEqual([
        "migrapilot.applyProposedEdit",
        "migrapilot.approveProposedEdit",
        "migrapilot.attachFile",
        "migrapilot.cancelResponse",
        "migrapilot.conversationState",
        "migrapilot.conversations.clearSearch",
        "migrapilot.conversations.delete",
        "migrapilot.conversations.pin",
        "migrapilot.conversations.refresh",
        "migrapilot.conversations.rename",
        "migrapilot.conversations.search",
        "migrapilot.conversations.unpin",
        "migrapilot.explainCurrentFile",
        "migrapilot.history",
        "migrapilot.newChat",
        "migrapilot.openChat",
        "migrapilot.rejectProposedEdit",
        "migrapilot.resumeConversation",
        "migrapilot.reviewProposedEdit",
        "migrapilot.reviewSelection",
        "migrapilot.rollbackProposedEdit",
    ]);
  });

  it("S1b: the duplicate-registration guard actually fires on a second registration", () => {
    activate(fakeContext());
    // a second activation without disposing would double-register — must throw
    expect(() => activate(fakeContext())).toThrow(/already registered/);
  });
});
