/**
 * Dry-run is the default. It was also HARDCODED.
 *
 * `dryRun: true` was pinned in the request body, and the server only asks for approval on a LIVE
 * mutation — so the approval card could never fire from the GUI. The whole Phase D path would
 * have shipped as a capability while being unreachable dead code: the same "it reads as coverage"
 * failure that hid the Phase D concurrency tests, this time in the product.
 *
 * These tests pin both halves: safe by default, and actually reachable.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { SseTestServer } from "../harness/sseServer";
import { makeClient, runChat, __resetConfig } from "../harness/pilotHarness";

const server = new SseTestServer();
let base: string;

beforeEach(async () => { __resetConfig(); base = await server.start(); server.requests.length = 0; });

describe("dry-run is the default", () => {
  it("with no setting, the request is dryRun — nothing can mutate", async () => {
    server.respondWith({ frames: [{ event: "done", data: {} }] });
    const c = makeClient({ "migrapilot.pilotApiUrl": base });
    await runChat(c, "provision a pod");
    expect(server.requests.at(-1)?.body?.dryRun).toBe(true);
  });

  it("explicitly OFF is still dry-run", async () => {
    server.respondWith({ frames: [{ event: "done", data: {} }] });
    const c = makeClient({ "migrapilot.pilotApiUrl": base, "migrapilot.execution.live": false });
    await runChat(c, "provision a pod");
    expect(server.requests.at(-1)?.body?.dryRun).toBe(true);
  });
});

describe("…but live execution is REACHABLE, or the approval card is dead code", () => {
  it("with execution.live on, the request is live — so the server can stop and ask", async () => {
    server.respondWith({ frames: [{ event: "done", data: {} }] });
    const c = makeClient({ "migrapilot.pilotApiUrl": base, "migrapilot.execution.live": true });
    await runChat(c, "provision a pod");
    expect(server.requests.at(-1)?.body?.dryRun).toBe(false);
  });
});
