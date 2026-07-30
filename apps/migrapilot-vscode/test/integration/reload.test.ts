/**
 * I3 — does the conversation survive a REAL window reload?
 *
 * The earlier proof was not good enough, and the GUI caught it. That test simulated the
 * reload by sending the conversationId itself, which only ever proved the SERVER rehydrates.
 * The extension's own path — capture the id, persist it, restore it after a restart, send it
 * back — was tested against a fake in-memory memento and never end to end.
 *
 * This is the real thing. @vscode/test-electron reuses a persistent --user-data-dir, so two
 * separate VS Code launches ARE a reload: phase 1's `workspaceState` is genuinely gone from
 * memory and must be read back off disk by a brand-new extension host.
 *
 * It observes the ACTUAL request the extension puts on the wire by patching global fetch,
 * and it drives a REAL command (`migrapilot.explainCurrentFile` -> handleUserMessage), so
 * nothing about the message path is faked.
 *
 *   SMOKE_PHASE=1  say something; record the conversationId the extension sent/stored
 *   SMOKE_PHASE=2  (fresh host = reload) assert it sends THE SAME conversationId
 *
 * ⚠️ PHASE 2 CANNOT PASS UNDER @vscode/test-electron TODAY, and that is not a product bug.
 * The test host boots VS Code with IN-MEMORY storage:
 *
 *   [shared storage] Creating shared storage database at ':memory:'
 *   [shared storage] Initializing fallback application storage (path: in-memory)
 *
 * `state.vscdb` is never written, so workspaceState cannot survive a restart HERE no matter
 * what the extension does. Phase 1 is therefore the part that is meaningful in CI (it proves
 * the id is captured, persisted into the memento, and sent on the next turn). Phase 2 is kept
 * because it is the right test — it will start passing the day the harness gets real storage,
 * and until then the reload remains an operator step (MANUAL_SMOKE I3).
 */

import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

const PHASE = process.env.SMOKE_PHASE ?? "1";
const STATE = process.env.SMOKE_STATE_FILE ?? "/tmp/i3-phase.json";

/** Bodies the extension actually POSTed to the chat stream. */
const sentBodies: any[] = [];

function captureChatRequests() {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    if (url.includes("/api/pilot/chat/stream") && init?.body) {
      try { sentBodies.push(JSON.parse(String(init.body))); } catch { /* ignore */ }
    }
    return real(input, init);
  }) as typeof fetch;
}

/** Drive a REAL entry point into the extension's message path. */
async function sendViaExtension(): Promise<void> {
  const ws = vscode.workspace.workspaceFolders![0].uri;
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(ws, "src", "total.ts"));
  await vscode.window.showTextDocument(doc);
  // This command calls handleUserMessage() — the same path the chat box uses.
  await vscode.commands.executeCommand("migrapilot.explainCurrentFile");
}

async function waitForRequest(timeoutMs = 60_000): Promise<any> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (sentBodies.length) return sentBodies[sentBodies.length - 1];
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("the extension never POSTed to /api/pilot/chat/stream");
}

suite(`I3 — conversation survives a real reload (phase ${PHASE})`, () => {
  suiteSetup(async function () {
    this.timeout(60_000);
    captureChatRequests(); // BEFORE activation, so the very first request is seen
    const ext = vscode.extensions.getExtension("migrateck.migrapilot-vscode");
    assert.ok(ext, "extension not found");
    await ext!.activate();
  });

  if (PHASE === "1") {
    test("phase 1: the extension captures and stores a real conversationId", async function () {
      this.timeout(180_000);
      await sendViaExtension();
      const body = await waitForRequest();

      // The FIRST turn legitimately has no id — it is starting the thread.
      assert.strictEqual(body.conversationId, undefined, "first turn should not carry an id");

      // Give the stream time to deliver the `conversation` event and persist it.
      await new Promise((r) => setTimeout(r, 20_000));

      // Now a SECOND turn in the same host must carry the id the server issued.
      sentBodies.length = 0;
      await sendViaExtension();
      const second = await waitForRequest();
      assert.ok(
        second.conversationId,
        "the extension did not send a conversationId on the second turn — it never captured the `conversation` event",
      );
      assert.ok(
        !String(second.conversationId).startsWith("dryrun-"),
        "conversation is ephemeral, not persisted",
      );

      // Now interrogate the extension itself: is the value merely in memory, or PERSISTED?
      const api: any = vscode.extensions.getExtension("migrateck.migrapilot-vscode")!.exports;
      await api.whenPersisted();
      const inMemory = api.getConversationId();
      const persisted = api.getPersistedConversationId();
      console.log(`    [phase 1] in-memory  = ${inMemory}`);
      console.log(`    [phase 1] PERSISTED  = ${persisted}`);
      assert.strictEqual(inMemory, second.conversationId, "in-memory id diverged from what was sent");
      assert.strictEqual(
        persisted,
        second.conversationId,
        "THE BUG: the id is in memory but NOT in workspaceState — a reload will lose the thread",
      );

      fs.writeFileSync(STATE, JSON.stringify({ conversationId: second.conversationId }));
    });
  } else {
    test("phase 2 (RELOAD): a brand-new extension host restores it from workspaceState and sends it", async function () {
      this.timeout(180_000);
      assert.ok(fs.existsSync(STATE), "phase 1 did not run");
      const { conversationId: expected } = JSON.parse(fs.readFileSync(STATE, "utf8"));

      // Nothing in memory carries over: this is a different process, a different host.
      await sendViaExtension();
      const body = await waitForRequest();

      assert.ok(
        body.conversationId,
        "THE BUG: after a reload the extension sent NO conversationId — the thread was lost, " +
          "so the server had nothing to rehydrate and the model could not know the test color.",
      );
      assert.strictEqual(
        body.conversationId,
        expected,
        `after a reload the extension sent a DIFFERENT conversation (${body.conversationId}), not the restored one (${expected})`,
      );
      console.log(`    [phase 2] restored and sent conversationId = ${body.conversationId}`);
    });
  }
});
