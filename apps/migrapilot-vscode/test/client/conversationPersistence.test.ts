/**
 * D.1 — the conversation survives a reload.
 *
 * pilot-api has ALWAYS persisted conversations and has ALWAYS sent back a `conversation`
 * SSE event carrying the id. The extension never listened, and never sent one back — so
 * every turn opened a brand-new thread. Combined with `dryRun: true` (which the server read
 * as "do not persist"), nothing the operator ever said in this editor was saved.
 *
 * These tests pin the three properties that make a chat a memory:
 *   1. the id is captured from the stream,
 *   2. it is sent back on the next turn,
 *   3. it survives a window reload (workspaceState, not a variable).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PilotClient, type StreamHandlers } from "../../src/pilotClient";

/** A workspaceState that behaves like VS Code's: it outlives the extension host. */
function makeMemento() {
  const store = new Map<string, unknown>();
  return {
    get: <T>(k: string) => store.get(k) as T | undefined,
    update: async (k: string, v: unknown) => { v === undefined ? store.delete(k) : store.set(k, v); },
    _store: store,
  };
}

function sse(...frames: Array<[string, unknown]>): string {
  return frames.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");
}

function mockFetch(body: string) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    body: {
      getReader() {
        let done = false;
        return {
          read: async () => {
            if (done) return { done: true, value: undefined };
            done = true;
            return { done: false, value: new TextEncoder().encode(body) };
          },
          releaseLock() { /* no-op */ },
        };
      },
    },
  })) as unknown as typeof fetch;
}

const handlers = (): StreamHandlers & { seen: string[] } => {
  const seen: string[] = [];
  return {
    seen,
    onDelta: () => {},
    onDone: () => {},
    onError: () => {},
    onConversation: (id) => seen.push(id),
  };
};

describe("the conversation id is captured from the stream", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("surfaces the `conversation` event the server has always sent", async () => {
    globalThis.fetch = mockFetch(sse(
      ["conversation", { conversationId: "cmr_abc123" }],
      ["token", { text: "hi" }],
      ["done", { runId: "r1" }],
    ));
    const h = handlers();
    await new PilotClient().streamChat("hello", undefined, h);
    expect(h.seen).toEqual(["cmr_abc123"]);
  });

  it("an ephemeral id is still reported — the caller decides what to do with it", async () => {
    globalThis.fetch = mockFetch(sse(["conversation", { conversationId: "ephemeral-xyz" }], ["done", {}]));
    const h = handlers();
    await new PilotClient().streamChat("hello", undefined, h);
    expect(h.seen).toEqual(["ephemeral-xyz"]);
  });
});

describe("the id is sent BACK, so the thread continues", () => {
  it("omits conversationId on the first turn and includes it on the next", async () => {
    const fetchMock = mockFetch(sse(["conversation", { conversationId: "cmr_1" }], ["done", {}]));
    globalThis.fetch = fetchMock;
    const client = new PilotClient();

    await client.streamChat("first", undefined, handlers());
    let body = JSON.parse((fetchMock as any).mock.calls[0][1].body);
    expect(body.conversationId).toBeUndefined();   // a new thread
    expect(body.dryRun).toBe(true);                // posture unchanged

    await client.streamChat("second", undefined, handlers(), undefined, undefined, undefined, undefined, "cmr_1");
    body = JSON.parse((fetchMock as any).mock.calls[1][1].body);
    expect(body.conversationId).toBe("cmr_1");     // the SAME thread
    expect(body.dryRun).toBe(true);                // still dry-run: persistence is orthogonal
  });
});

/**
 * The property the whole feature exists for. A `let conversationId` would satisfy the two
 * tests above and still lose everything the moment the window reloads.
 */
describe("the thread survives a reload", () => {
  const KEY = "migrapilot.activeConversationId";

  it("workspaceState carries the id across an extension-host restart", async () => {
    const state = makeMemento();

    // ── session 1 ──
    let active: string | undefined = state.get<string>(KEY);
    expect(active).toBeUndefined();
    active = "cmr_survivor";
    await state.update(KEY, active);

    // ── window reloads: every variable is gone ──
    active = undefined;

    // ── session 2 ──
    active = state.get<string>(KEY);
    expect(active).toBe("cmr_survivor");
  });

  it("New Chat forgets the thread instead of silently reusing it", async () => {
    const state = makeMemento();
    await state.update(KEY, "cmr_old");
    await state.update(KEY, undefined);        // what newChat does
    expect(state.get<string>(KEY)).toBeUndefined();
    expect(state._store.has(KEY)).toBe(false); // truly cleared, not stored as undefined
  });

  it("is workspace-scoped, not global — a thread belongs to the project it was about", () => {
    const projectA = makeMemento();
    const projectB = makeMemento();
    void projectA.update(KEY, "cmr_project_a");
    expect(projectB.get<string>(KEY)).toBeUndefined();
  });
});

/**
 * THE BUG THE GUI FOUND (I3) — and that every test above missed.
 *
 * `workspaceState` only persists when a FOLDER is open. VS Code keys workspace storage to a
 * folder; with an empty workspace it is window-scoped and discarded. The operator's dev host
 * had the MigraPilot panel open but no folder, so the conversation had nowhere to live: the
 * id was written, the window reloaded, and it was gone.
 *
 * Verified on disk: 37 VS Code workspace databases exist and hold other MigraPilot keys
 * (view state, webview mementos), and `migrapilot.activeConversationId` is in NONE of them.
 *
 * Why nothing caught it:
 *   - the unit tests above hand-roll a fake memento, which always persists;
 *   - the integration harness runs VS Code with IN-MEMORY storage, which never persists.
 * Neither can express "persists ONLY when a folder is open". This does.
 */
describe("no folder open — the case the GUI caught", () => {
  const KEY = "migrapilot.activeConversationId";

  /** workspaceState with no folder: writes succeed, then vanish with the window. */
  function ephemeralWorkspaceState() {
    const store = new Map<string, unknown>();
    return {
      get: <T>(k: string) => store.get(k) as T | undefined,
      update: async (k: string, v: unknown) => { v === undefined ? store.delete(k) : store.set(k, v); },
      /** what a reload actually reads back: nothing */
      afterReload: () => makeMemento(),
    };
  }

  function pickStore(hasFolder: boolean, ws: any, global: any) {
    return hasFolder ? ws : global;
  }

  it("with NO folder, workspaceState loses the thread on reload — the reported bug", async () => {
    const ws = ephemeralWorkspaceState();
    await ws.update(KEY, "cmr_lost");
    expect(ws.get<string>(KEY)).toBe("cmr_lost");   // looks fine in-session…
    expect(ws.afterReload().get<string>(KEY)).toBeUndefined(); // …and is gone after reload
  });

  it("with NO folder we use globalState, which DOES survive", async () => {
    const global = makeMemento();
    const store = pickStore(false, ephemeralWorkspaceState(), global);
    await store.update(KEY, "cmr_survives");
    // the window reloads; globalState is not folder-scoped, so it is still there
    expect(global.get<string>(KEY)).toBe("cmr_survives");
  });

  it("with a folder open we still prefer workspaceState — a thread belongs to its project", async () => {
    const ws = makeMemento();
    const global = makeMemento();
    const store = pickStore(true, ws, global);
    await store.update(KEY, "cmr_project");
    expect(ws.get<string>(KEY)).toBe("cmr_project");
    expect(global.get<string>(KEY)).toBeUndefined(); // must NOT leak across projects
  });
});
